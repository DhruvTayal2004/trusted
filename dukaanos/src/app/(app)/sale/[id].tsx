import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { formatPaise, parseRupees } from '@/core/money';
import { can, isManager } from '@/core/permissions';
import { formatQty } from '@/core/units';
import { useMember, useSession } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { createRefund, getSaleDetail, setLocalUpiStatus } from '@/lib/repos/sales';
import { currentShift } from '@/lib/repos/shifts';
import { Button, Card, Chip, Field, Loading, Money, MoneyField, Pill, Row, Screen, SectionTitle, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function SaleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const member = useMember();
  const { shop } = useSession();
  const q = useQuery(() => getSaleDetail(id), [id]);
  const [refunding, setRefunding] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi' | 'credit'>('cash');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const d = q.data;
  if (!d) return <Loading />;
  const { sale, items, payments } = d;

  async function refund() {
    const p = parseRupees(amount);
    if (!p || p <= 0 || p > sale.total_paise) return Alert.alert('Enter an amount up to ' + formatPaise(sale.total_paise));
    if (!reason.trim()) return Alert.alert('Reason is required');
    setBusy(true);
    try {
      const shift = await currentShift(member.id);
      await createRefund({ shopId: shop!.id, memberId: member.id, shiftId: shift?.id ?? null, saleId: sale.id, method, amountPaise: p, reason: reason.trim(), restock: p === sale.total_paise });
      setRefunding(false);
      Alert.alert('Refund recorded', 'The original sale stays unchanged; a reversal record was added.');
      await q.refresh();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: `Bill · ${new Date(sale.client_created_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` }} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Money paise={sale.total_paise} variant="display" />
          <Pill label={sale.status.replace('_', ' ')} tone={sale.status === 'completed' ? 'success' : 'warning'} />
        </Row>
        {sale.discount_paise > 0 ? <T color={colors.textMuted}>Discount {formatPaise(sale.discount_paise)}{sale.discount_reason ? ` · ${sale.discount_reason}` : ''}</T> : null}
        <T variant="caption" color={colors.textMuted}>ID {sale.id.slice(0, 8)} · source {sale.source}</T>
      </Card>
      <SectionTitle>Items</SectionTitle>
      {items.map((it) => (
        <Row key={it.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
          <View style={{ flex: 1 }}><T>{it.description}</T><T variant="caption" color={colors.textMuted}>{formatQty(it.qty, it.unit)} × {formatPaise(it.unit_price_paise)}</T></View>
          <Money paise={it.line_total_paise} />
        </Row>
      ))}
      <SectionTitle>Payments</SectionTitle>
      {payments.map((p) => (
        <Row key={p.id} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
          <View style={{ flex: 1 }}>
            <T>{p.method.toUpperCase()}{p.upi_reference ? ` · ${p.upi_reference}` : ''}</T>
            {p.method === 'upi' ? <Pill label={p.status.replace('_', ' ')} tone={p.status === 'verified' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'} /> : null}
          </View>
          <Money paise={p.amount_paise} />
          {p.method === 'upi' && p.status === 'pending_verification' ? (
            <Row gap={4}>
              <Button title="✓" size="sm" onPress={() => void setLocalUpiStatus(p.id, 'verified').then(q.refresh)} style={{ width: 44 }} />
              <Button title="✗" size="sm" variant="danger" onPress={() => void setLocalUpiStatus(p.id, 'failed').then(q.refresh)} style={{ width: 44 }} />
            </Row>
          ) : null}
        </Row>
      ))}

      {(can(member, 'can_refund') || isManager(member)) && sale.status !== 'reversed' ? (
        refunding ? (
          <Card tone="danger">
            <T variant="heading">Refund</T>
            <MoneyField valueRupees={amount} onChangeRupees={setAmount} autoFocus />
            <Row style={{ marginBottom: spacing.md }}>
              <Chip label="Cash" selected={method === 'cash'} onPress={() => setMethod('cash')} />
              <Chip label="UPI" selected={method === 'upi'} onPress={() => setMethod('upi')} />
              {sale.customer_id ? <Chip label="Khata credit" selected={method === 'credit'} onPress={() => setMethod('credit')} /> : null}
            </Row>
            <Field label="Reason (required)" value={reason} onChangeText={setReason} />
            <Row><Button title="Record refund" variant="danger" onPress={refund} loading={busy} style={{ flex: 1 }} /><Button title="Cancel" variant="ghost" onPress={() => setRefunding(false)} /></Row>
          </Card>
        ) : <Button title="Refund" variant="secondary" onPress={() => { setAmount(String(sale.total_paise / 100)); setRefunding(true); }} style={{ marginTop: spacing.lg }} />
      ) : null}
      <Button title="New sale" variant="ghost" onPress={() => router.replace('/(app)/sale/new')} />
    </Screen>
  );
}
