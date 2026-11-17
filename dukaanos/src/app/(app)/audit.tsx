import { useQuery } from '@/features/useQuery';
import { supabase } from '@/lib/supabase';
import { Empty, ErrorBanner, ListRow, Pill, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function AuditScreen() {
  const q = useQuery(async () => {
    const { data, error } = await supabase.from('audit_log').select('id, table_name, record_id, action, reason, created_at, actor_member_id, shop_members:actor_member_id(display_name)').order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    return data as unknown as { id: number; table_name: string; record_id: string; action: string; reason: string | null; created_at: string; shop_members: { display_name: string } | null }[];
  });
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <ErrorBanner message={q.error ? `Needs internet: ${q.error}` : null} onRetry={q.refresh} />
      {q.data && q.data.length === 0 ? <Empty title="No audit entries" /> : null}
      {(q.data ?? []).map((a) => (
        <ListRow key={a.id} title={`${a.action} ${a.table_name}`} subtitle={`${a.shop_members?.display_name ?? 'system'} · ${new Date(a.created_at).toLocaleString()} · ${a.record_id.slice(0, 8)}${a.reason ? ' · ' + a.reason : ''}`} right={<Pill label={a.action} tone={a.action === 'delete' ? 'danger' : a.action === 'update' ? 'warning' : 'muted'} />} />
      ))}
      <T variant="caption" color={colors.textMuted} style={{ marginTop: 12 }}>Every insert/update on financial and master tables is recorded with the acting user. Financial rows cannot be updated or deleted; corrections appear as new reversal rows.</T>
    </Screen>
  );
}
