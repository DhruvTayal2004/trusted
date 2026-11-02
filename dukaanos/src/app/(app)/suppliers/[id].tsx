import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { parseRupees } from '@/core/money';
import { useMember, useSession } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { currentShift } from '@/lib/repos/shifts';
import { getSupplier, recordSupplierPayment, supplierLedger } from '@/lib/repos/suppliers';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Money, MoneyField, Row, Screen, SectionTitle, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

const LABEL: Record<string, string> = { opening_balance: 'Opening balance', purchase: 'Purchase', payment: 'Paid', adjustment: 'Adjustment', notebook_import: 'From notebook', reversal: 'Reversal' };

export default function SupplierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shop } = useSession();
  const member = useMember();
  const q = useQuery(async () => ({ s: await getSupplier(id), ledger: await supplierLedger(id) }), [id]);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = q.data?.s;
  if (!s) return <Loading />;

  async function pay() {
    const paise = parseRupees(amount);
    if (!paise || paise <= 0) return setError('Enter an amount');
    setBusy(true);
    try {
      const shift = await currentShift(member.id);
      await recordSupplierPayment({ shopId: shop!.id, memberId: member.id, shiftId: shift?.id ?? null, supplierId: id, method, amountPaise: paise, note: note || undefined });
      setPaying(false); setAmount(''); setNote('');
      await q.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: s.name }} />
      <Card>
        <T variant="caption" color={colors.textMuted}>We owe</T>
        <Money paise={s.balance_paise} variant="display" color={s.balance_paise > 0 ? colors.credit : colors.success} />
        {s.phone ? <T color={colors.textMuted}>{s.phone}</T> : null}
      </Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Pay supplier" icon="💵" onPress={() => setPaying(true)} />
        <Button title="Receive stock" variant="secondary" onPress={() => router.push({ pathname: '/(app)/purchases/new', params: { supplierId: s.id } })} />
      </Row>
      {paying ? (
        <Card tone="success">
          <ErrorBanner message={error} />
          <MoneyField valueRupees={amount} onChangeRupees={setAmount} autoFocus big />
          <Row style={{ marginBottom: spacing.md }}>
            <Chip label="Cash" selected={method === 'cash'} onPress={() => setMethod('cash')} color={colors.cash} />
            <Chip label="UPI / Bank" selected={method === 'upi'} onPress={() => setMethod('upi')} color={colors.upi} />
          </Row>
          <Field label="Note" value={note} onChangeText={setNote} />
          <Row><Button title="Save payment" onPress={pay} loading={busy} style={{ flex: 1 }} /><Button title="Cancel" variant="ghost" onPress={() => setPaying(false)} /></Row>
        </Card>
      ) : null}
      <SectionTitle>History</SectionTitle>
      {(q.data?.ledger ?? []).map((e) => (
        <Row key={e.id} style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
          <View style={{ flex: 1 }}><T>{LABEL[e.entry_type] ?? e.entry_type}{e.payment_method ? ` (${e.payment_method})` : ''}</T><T variant="caption" color={colors.textMuted}>{e.entry_date}{e.note ? ' · ' + e.note : ''}</T></View>
          <Money paise={Math.abs(e.amount_paise)} color={e.amount_paise > 0 ? colors.credit : colors.success} />
        </Row>
      ))}
    </Screen>
  );
}
