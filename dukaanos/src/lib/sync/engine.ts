import NetInfo from '@react-native-community/netinfo';
import { getDb, kvGet, kvSet } from '@/lib/db';
import { nowIso } from '@/lib/ids';
import { createStore } from '@/lib/store';
import { isPermanentRpcError, rpcErrorMessage, supabase } from '@/lib/supabase';
import { listOutbox, markRejected, markRetry, markSent, outboxCounts } from './outbox';
import { applyPulledChanges } from './pull';

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  rejected: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export const syncStore = createStore<SyncState>({ online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null, lastError: null });

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

export async function refreshCounts(): Promise<void> {
  const c = await outboxCounts();
  syncStore.set({ pending: c.pending, rejected: c.rejected });
}

/** Push every pending outbox op in order. Stops at the first network failure (will retry later). */
async function pushOutbox(): Promise<{ pushed: number; stoppedOnNetwork: boolean }> {
  const ops = await listOutbox('pending', 500);
  let pushed = 0;
  for (const op of ops) {
    const args = JSON.parse(op.payload) as Record<string, unknown>;
    // "upsert:<table>" ops are master-data writes (products/customers/suppliers) — plain table upserts under RLS.
    const { error } = op.rpc.startsWith('upsert:')
      ? await supabase.from(op.rpc.slice(7)).upsert(args, { onConflict: 'id' })
      : await supabase.rpc(op.rpc, args);
    if (!error && op.rpc.startsWith('upsert:')) {
      const db = await getDb();
      await db.runAsync(`update ${op.rpc.slice(7)} set dirty = 0 where id = ?`, op.record_id);
    }
    if (!error) {
      await markSent(op.op_id);
      pushed++;
      continue;
    }
    if (isPermanentRpcError(error)) {
      // Validation / permission failure: the server will never accept this. Surface it, never drop it.
      await markRejected(op.op_id, rpcErrorMessage(error));
      continue;
    }
    await markRetry(op.op_id, rpcErrorMessage(error));
    return { pushed, stoppedOnNetwork: true };
  }
  return { pushed, stoppedOnNetwork: false };
}

async function pullChanges(): Promise<void> {
  let since = (await kvGet('sync_cursor')) ?? '1970-01-01T00:00:00Z';
  for (let round = 0; round < 10; round++) {
    const { data, error } = await supabase.rpc('pull_changes', { p_since: since, p_limit: 500 });
    if (error) throw error;
    const payload = data as Record<string, unknown[]> & { server_time: string };
    const { maxUpdatedAt, hitLimit } = await applyPulledChanges(payload);
    const next = maxUpdatedAt ?? payload.server_time;
    if (!hitLimit) {
      // Use server_time minus a small overlap to tolerate clock skew between transactions.
      const t = new Date(payload.server_time).getTime() - 2000;
      since = new Date(t).toISOString();
      break;
    }
    since = next;
  }
  await kvSet('sync_cursor', since);
}

export async function syncNow(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    syncStore.set({ syncing: true, lastError: null });
    try {
      const net = await NetInfo.fetch();
      const online = Boolean(net.isConnected && net.isInternetReachable !== false);
      syncStore.set({ online });
      if (!online) return;
      const { stoppedOnNetwork } = await pushOutbox();
      await refreshCounts();
      if (stoppedOnNetwork) {
        syncStore.set({ lastError: 'Could not reach server; will retry' });
        return;
      }
      await pullChanges();
      const at = nowIso();
      await kvSet('last_sync_at', at);
      syncStore.set({ lastSyncAt: at });
    } catch (e) {
      syncStore.set({ lastError: rpcErrorMessage(e) });
    } finally {
      syncStore.set({ syncing: false });
      inFlight = null;
    }
  })();
  return inFlight;
}

export function startSync(): void {
  if (started) return;
  started = true;
  void (async () => {
    syncStore.set({ lastSyncAt: await kvGet('last_sync_at') });
    await refreshCounts();
    void syncNow();
  })();
  NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable !== false);
    syncStore.set({ online });
    if (online) void syncNow();
  });
  timer = setInterval(() => void syncNow(), 30_000);
}

export function stopSync(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

/** Full re-download of master data + recent events (owner "Resync" button). */
export async function fullResync(): Promise<void> {
  await kvSet('sync_cursor', null);
  const db = await getDb();
  await db.runAsync(`delete from sync_conflicts where resolved = 1`);
  await syncNow();
}
