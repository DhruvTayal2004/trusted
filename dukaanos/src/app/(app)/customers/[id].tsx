import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { formatPaise, parseRupees } from '@/core/money';
import { isManager } from '@/core/permissions';
import { useMember, useSession } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { customerLedger, getCustomer, recordKhataEntry, recordKhataPayment } from '@/lib/repos/customers';
import { currentShift } from '@/lib/repos/shifts';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Money, MoneyField, Pill, Row, Screen, SectionTitle, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

const TYPE_LABEL: Record<string, string> = { opening_balance: 'Opening balance', credit_sale: 'Udhaar (sale)', payment: 'Payment received', adjustment: 'Adjustment', notebook_import: 'From notebook', reversal: 'Reversal' };

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { shop } = useSession();
  const member = useMember();
  const q = useQuery(async () => ({ customer: await getCustomer(id), ledger: await customerLedger(id, 200) }), [id]);
  const [mode, setMode] = useState<'none' | 'pay' | 'udhaar' | 'adjust'>('none');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = q.data?.customer;
  if (!c) return <Loading />;

  async function submit() {
    const paise = parseRupees(amount);
    if (paise === null || paise === 0) return setError('Enter an amount');
    setBusy(true);
    setError(null);
    try {
      const shift = await currentShift(member.id);
      if (mode === 'pay') await recordKhataPayment({ shopId: shop!.id, memberId: member.id, shiftId: shift?.id ?? null, customerId: id, method, amountPaise: Math.abs(paise), note: note || undefined });
      else if (mode === 'udhaar') await recordKhataEntry({ shopId: shop!.id, memberId: member.id, customerId: id, entryType: 'credit_sale', amountPaise: Math.abs(paise), note: note || 'Udhaar without bill' });
      else if (mode === 'adjust') {
        if (!note.trim()) throw new Error('Adjustment needs a reason');
        await recordKhataEntry({ shopId: shop!.id, memberId: member.id, customerId: id, entryType: 'adjustment', amountPaise: paise, note });
      }
      setMode('none'); setAmount(''); setNote('');
      await q.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const reminder = `Namaste ${c.name} ji, ${shop?.name} se. Aapka baaki udhaar ${formatPaise(c.balance_paise)} hai. Kripya jald bhugtan karein. Dhanyavaad 🙏`;

  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <Stack.Screen options={{ title: c.name }} />
      <Card>
        <T variant="caption" color={colors.textMuted}>{c.balance_paise >= 0 ? 'Customer owes' : 'Advance with us'}</T>
        <Money paise={Math.abs(c.balance_paise)} variant="display" color={c.balance_paise > 0 ? colors.credit : colors.success} />
        {c.phone ? <T color={colors.textMuted}>{c.phone}</T> : null}
      </Card>
      <Row style={{ flexWrap: 'wrap' }}>
        <Button title="Payment received" icon="💵" onPress={() => setMode('pay')} />
        <Button title="Add udhaar" icon="📒" variant="secondary" onPress={() => setMode('udhaar')} />
        {isManager(member) ? <Button title="Adjust" variant="secondary" onPress={() => setMode('adjust')} /> : null}
        {c.phone && c.balance_paise > 0 ? <Button title="WhatsApp reminder" icon="💬" variant="ghost" onPress={() => Linking.openURL(`https://wa.me/91${c.phone!.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(reminder)}`)} /> : null}
        <Button title="New sale for this customer" variant="ghost" onPress={() => router.push({ pathname: '/(app)/sale/new', params: { customerId: c.id } })} />
      </Row>

      {mode !== 'none' ? (
        <Card tone={mode === 'pay' ? 'success' : mode === 'udhaar' ? 'warning' : 'info'}>
          <T variant="heading">{mode === 'pay' ? 'Payment received' : mode === 'udhaar' ? 'Add udhaar (no bill)' : 'Adjust balance'}</T>
          <ErrorBanner message={error} />
          <MoneyField valueRupees={amount} onChangeRupees={setAmount} autoFocus big />
          {mode === 'pay' ? (
            <Row style={{ marginBottom: spacing.md }}>
              <Chip label="Cash" selected={method === 'cash'} onPress={() => setMethod('cash')} color={colors.cash} />
              <Chip label="UPI" selected={method === 'upi'} onPress={() => setMethod('upi')} color={colors.upi} />
            </Row>
          ) : null}
          {mode === 'adjust' ? <T variant="caption" color={colors.textMuted}>Use a negative amount to reduce the balance. A reason is required and is kept in the audit log.</T> : null}
          <Field label={mode === 'adjust' ? 'Reason (required)' : 'Note (optional)'} value={note} onChangeText={setNote} placeholder={mode === 'udhaar' ? 'e.g. 2 kg atta' : ''} />
          <Row>
            <Button title="Save" onPress={submit} loading={busy} style={{ flex: 1 }} />
            <Button title="Cancel" variant="ghost" onPress={() => { setMode('none'); setError(null); }} />
          </Row>
        </Card>
      ) : null}

      <SectionTitle>Transaction history</SectionTitle>
      {(q.data?.ledger ?? []).map((e) => (
        <Row key={e.id} style={{ justifyContent: 'space-between', paddingVertical: 8 }}>
          <View style={{ flex: 1 }}>
            <T>{TYPE_LABEL[e.entry_type] ?? e.entry_type}</T>
            <T variant="caption" color={colors.textMuted} numberOfLines={1}>{e.entry_date}{e.note ? ' · ' + e.note : ''}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Money paise={Math.abs(e.amount_paise)} color={e.amount_paise > 0 ? colors.credit : colors.success} />
            <Pill label={e.amount_paise > 0 ? 'owes more' : 'paid'} tone={e.amount_paise > 0 ? 'warning' : 'success'} />
          </View>
        </Row>
      ))}
      {q.data && q.data.ledger.length === 0 ? <T color={colors.textMuted}>No entries yet.</T> : null}
    </Screen>
  );
}
