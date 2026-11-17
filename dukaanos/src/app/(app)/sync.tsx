import { useState } from 'react';
import { View } from 'react-native';
import { isManager } from '@/core/permissions';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { getDb } from '@/lib/db';
import { fullResync, syncNow, syncStore } from '@/lib/sync/engine';
import { listOutbox, requeue } from '@/lib/sync/outbox';
import { Button, Card, ListRow, Pill, Row, Screen, SectionTitle, T } from '@/ui';
import { colors } from '@/ui/theme';

/** Visible sync state: what is on this phone but not yet on the server, and why anything was rejected. */
export default function SyncScreen() {
  const s = syncStore.use();
  const member = useMember();
  const [busy, setBusy] = useState(false);
  const q = useQuery(async () => {
    const db = await getDb();
    return { ops: await listOutbox(undefined, 100), conflicts: await db.getAllAsync<{ id: string; table_name: string; record_id: string; detected_at: string; resolved: number }>('select * from sync_conflicts where resolved = 0 order by detected_at desc limit 50') };
  });
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Card tone={!s.online ? 'warning' : s.rejected ? 'danger' : s.pending ? 'info' : 'success'}>
        <T variant="heading">{!s.online ? 'Offline' : s.syncing ? 'Syncing…' : 'Online'}</T>
        <T color={colors.textMuted}>{s.pending} waiting · {s.rejected} rejected · last sync {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : 'never'}</T>
        {s.lastError ? <T color={colors.danger}>{s.lastError}</T> : null}
        <Row>
          <Button title="Sync now" onPress={() => void syncNow().then(q.refresh)} loading={s.syncing} />
          {isManager(member) ? <Button title="Full resync" variant="secondary" onPress={async () => { setBusy(true); await fullResync(); setBusy(false); await q.refresh(); }} loading={busy} /> : null}
        </Row>
        <T variant="caption" color={colors.textMuted}>Offline records are kept on this phone until the server accepts them. Nothing is dropped silently.</T>
      </Card>
      {q.data?.conflicts.length ? (
        <>
          <SectionTitle>Conflicts</SectionTitle>
          {q.data.conflicts.map((c) => <ListRow key={c.id} title={`${c.table_name} edited on two devices`} subtitle={`${c.record_id.slice(0, 8)} · ${new Date(c.detected_at).toLocaleString()} · server copy kept; re-apply your change if needed`} />)}
        </>
      ) : null}
      <SectionTitle>Queue</SectionTitle>
      {(q.data?.ops ?? []).map((op) => (
        <ListRow key={op.op_id} title={`${op.rpc.replace('upsert:', 'save ')} · ${op.record_table}`} subtitle={`${new Date(op.created_at).toLocaleString()}${op.last_error ? ' · ' + op.last_error : ''}`}
          right={<View style={{ alignItems: 'flex-end' }}><Pill label={op.status} tone={op.status === 'sent' ? 'success' : op.status === 'rejected' ? 'danger' : 'info'} />{op.status === 'rejected' ? <Button title="Retry" size="sm" variant="ghost" onPress={() => void requeue(op.op_id).then(syncNow).then(q.refresh)} /> : null}</View>} />
      ))}
      {q.data && q.data.ops.length === 0 ? <T color={colors.textMuted}>Nothing queued.</T> : null}
    </Screen>
  );
}
