import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { isManager } from '@/core/permissions';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { todayLocal } from '@/lib/ids';
import { listExpenses } from '@/lib/repos/expenses';
import { Button, Chip, Empty, ListRow, Money, Pill, Row, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function ExpensesScreen() {
  const member = useMember();
  const [scope, setScope] = useState<'today' | 'all'>('today');
  const q = useQuery(() => listExpenses({ date: scope === 'today' ? todayLocal() : undefined }), [scope]);
  const total = (q.data ?? []).filter((e) => e.status !== 'rejected').reduce((a, e) => a + e.amount_paise, 0);
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row><Chip label="Today" selected={scope === 'today'} onPress={() => setScope('today')} /><Chip label="All" selected={scope === 'all'} onPress={() => setScope('all')} /></Row>
        <Money paise={total} variant="heading" color={colors.danger} />
      </Row>
      <Button title="Record expense" icon="💸" size="lg" onPress={() => router.push('/(app)/expenses/new')} />
      {isManager(member) ? <Button title="Approvals" variant="ghost" onPress={() => router.push('/(app)/approvals')} /> : null}
      {q.data && q.data.length === 0 ? <Empty title="No expenses" /> : null}
      {(q.data ?? []).map((e) => (
        <ListRow key={e.id} title={`${e.category_name}${e.note ? ' · ' + e.note : ''}`} subtitle={`${e.expense_date} · ${e.paid_method}${e.receipt_image_path ? ' · 📷' : ''}`}
          right={<View style={{ alignItems: 'flex-end' }}><Money paise={e.amount_paise} />{e.status !== 'recorded' ? <Pill label={e.status.replace('_', ' ')} tone={e.status === 'approved' ? 'success' : e.status === 'rejected' ? 'danger' : 'warning'} /> : null}</View>} />
      ))}
      <T variant="caption" color={colors.textMuted} style={{ marginTop: 12 }}>Expenses cannot be edited; record a correcting entry if something was wrong.</T>
    </Screen>
  );
}
