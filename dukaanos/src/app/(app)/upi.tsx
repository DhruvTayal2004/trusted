import { View } from 'react-native';
import { useQuery } from '@/features/useQuery';
import { pendingUpiPayments, setLocalUpiStatus } from '@/lib/repos/sales';
import { Button, Card, Empty, ListRow, Money, Row, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

/** UPI reconciliation: every UPI payment is 'pending verification' until confirmed against the UPI app / bank. */
export default function UpiScreen() {
  const q = useQuery(() => pendingUpiPayments(100));
  const total = (q.data ?? []).reduce((a, p) => a + p.amount_paise, 0);
  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Card tone="info">
        <T variant="label">Unverified UPI</T>
        <Money paise={total} variant="display" color={colors.upi} />
        <T variant="caption" color={colors.textMuted}>Open your UPI app, match each amount, then mark ✓ received or ✗ failed. UPI never counts toward drawer cash.</T>
      </Card>
      {q.data && q.data.length === 0 ? <Empty title="All UPI payments verified" /> : null}
      {(q.data ?? []).map((p) => (
        <ListRow key={p.id} title={`${new Date(p.client_created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}${p.upi_reference ? ' · ref ' + p.upi_reference : ''}`} subtitle={p.sale_id ? 'Sale' : 'Khata collection'}
          right={<View style={{ alignItems: 'flex-end' }}><Money paise={p.amount_paise} /><Row gap={4}><Button title="✓" size="sm" onPress={() => void setLocalUpiStatus(p.id, 'verified').then(q.refresh)} style={{ width: 44 }} /><Button title="✗" size="sm" variant="danger" onPress={() => void setLocalUpiStatus(p.id, 'failed').then(q.refresh)} style={{ width: 44 }} /></Row></View>} />
      ))}
    </Screen>
  );
}
