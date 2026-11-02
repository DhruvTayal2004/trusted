import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { isManager } from '@/core/permissions';
import { SyncBadge } from '@/features/SyncBadge';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { todayLocal } from '@/lib/ids';
import { listSales } from '@/lib/repos/sales';
import { Button, Chip, Empty, ListRow, Money, Pill, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function SalesTab() {
  const member = useMember();
  const [scope, setScope] = useState<'today' | 'all'>('today');
  const q = useQuery(() => listSales({ date: scope === 'today' ? todayLocal() : undefined, memberId: isManager(member) ? undefined : member.id, limit: 200 }), [scope, member.id]);
  const total = (q.data ?? []).filter((s) => s.status !== 'reversed').reduce((a, s) => a + s.total_paise, 0);
  return (
    <>
      <Stack.Screen options={{ title: 'Sales', headerRight: () => <SyncBadge /> }} />
      <Screen refreshing={q.loading} onRefresh={q.refresh}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row>
            <Chip label="Today" selected={scope === 'today'} onPress={() => setScope('today')} />
            <Chip label="All" selected={scope === 'all'} onPress={() => setScope('all')} />
          </Row>
          <Money paise={total} variant="heading" />
        </Row>
        <Button title="New sale" icon="🧾" size="lg" onPress={() => router.push('/(app)/sale/new')} style={{ marginVertical: spacing.md }} />
        {q.data && q.data.length === 0 ? <Empty title="No sales yet" hint="Tap New sale to record the first bill." /> : null}
        {(q.data ?? []).map((s) => (
          <ListRow
            key={s.id}
            title={s.items_summary ?? 'Sale'}
            subtitle={`${new Date(s.client_created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${s.methods ?? ''}${s.source === 'voice' ? ' · 🎤' : ''}`}
            right={<View style={{ alignItems: 'flex-end' }}><Money paise={s.total_paise} color={s.status === 'reversed' ? colors.textMuted : colors.text} />{s.status !== 'completed' ? <Pill label={s.status.replace('_', ' ')} tone="warning" /> : null}</View>}
            onPress={() => router.push({ pathname: '/(app)/sale/[id]', params: { id: s.id } })}
          />
        ))}
        {q.error ? <T color={colors.danger}>{q.error}</T> : null}
      </Screen>
    </>
  );
}
