import { getDb } from '@/lib/db';
import { newId, nowIso } from '@/lib/ids';

export type OutboxStatus = 'pending' | 'sent' | 'rejected';

export interface OutboxOp {
  op_id: string;
  seq: number;
  rpc: string;
  payload: string; // JSON of the RPC args object
  record_table: string;
  record_id: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
}

/** Queue an RPC call. `args` is the exact argument object passed to supabase.rpc(rpc, args). */
export async function enqueue(rpc: string, args: Record<string, unknown>, recordTable: string, recordId: string, opId: string = newId()): Promise<string> {
  const db = await getDb();
  const seqRow = await db.getFirstAsync<{ m: number | null }>('select max(seq) as m from outbox');
  const seq = (seqRow?.m ?? 0) + 1;
  await db.runAsync(
    'insert or ignore into outbox(op_id, seq, rpc, payload, record_table, record_id, status, attempts, created_at) values (?,?,?,?,?,?,?,?,?)',
    opId, seq, rpc, JSON.stringify(args), recordTable, recordId, 'pending', 0, nowIso(),
  );
  return opId;
}

export async function listOutbox(status?: OutboxStatus, limit = 200): Promise<OutboxOp[]> {
  const db = await getDb();
  if (status) return db.getAllAsync<OutboxOp>('select * from outbox where status = ? order by seq limit ?', status, limit);
  return db.getAllAsync<OutboxOp>('select * from outbox order by seq desc limit ?', limit);
}

export async function outboxCounts(): Promise<{ pending: number; rejected: number; sent: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: OutboxStatus; c: number }>('select status, count(*) c from outbox group by status');
  const out = { pending: 0, rejected: 0, sent: 0 };
  for (const r of rows) out[r.status] = r.c;
  return out;
}

export async function markSent(opId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('update outbox set status = ?, sent_at = ?, last_error = null where op_id = ?', 'sent', nowIso(), opId);
}

export async function markRejected(opId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('update outbox set status = ?, last_error = ?, attempts = attempts + 1 where op_id = ?', 'rejected', error, opId);
}

export async function markRetry(opId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('update outbox set last_error = ?, attempts = attempts + 1 where op_id = ?', error, opId);
}

/** Owner can re-queue a rejected op after fixing the cause (e.g. permission granted). */
export async function requeue(opId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('update outbox set status = ? where op_id = ? and status = ?', 'pending', opId, 'rejected');
}
