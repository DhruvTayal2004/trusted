import { View } from 'react-native';
import { useQuery } from '@/features/useQuery';
import { decideExpenseLocal, listExpenses } from '@/lib/repos/expenses';
import { Button, Empty, ListRow, Money, Row, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function ApprovalsScreen() {
  const q = useQuery(() => listExpenses({ status: 'pending_approval' }));
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      {q.data && q.data.length === 0 ? <Empty title="Nothing waiting" hint="Expenses in categories marked 'requires approval' appear here when an employee records them." /> : null}
      {(q.data ?? []).map((e) => (
        <ListRow key={e.id} title={`${e.category_name}${e.note ? ' · ' + e.note : ''}`} subtitle={`${e.expense_date} · ${e.paid_method}`}
          right={<View style={{ alignItems: 'flex-end' }}><Money paise={e.amount_paise} /><Row gap={4}><Button title="Approve" size="sm" onPress={() => void decideExpenseLocal(e.id, true).then(q.refresh)} /><Button title="Reject" size="sm" variant="danger" onPress={() => void decideExpenseLocal(e.id, false).then(q.refresh)} /></Row></View>} />
      ))}
      <T variant="caption" color={colors.textMuted}>Rejected expenses stay in the record (marked rejected) and are excluded from cash reconciliation.</T>
    </Screen>
  );
}
