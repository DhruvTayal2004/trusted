import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { formatPaise, parseRupees } from '@/core/money';
import { useMember } from '@/features/session';
import { useQuery } from '@/features/useQuery';
import { pendingUpiPayments } from '@/lib/repos/sales';
import { closeShift, currentShift, localShiftSummary } from '@/lib/repos/shifts';
import { syncNow } from '@/lib/sync/engine';
import { Button, Card, ErrorBanner, Field, Loading, Money, MoneyField, Row, Screen, SectionTitle, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function CloseShiftScreen() {
  const member = useMember();
  const q = useQuery(async () => {
    const shift = await currentShift(member.id);
    if (!shift) return null;
    return { shift, summary: await localShiftSummary(shift), upiPending: (await pendingUpiPayments()).length };
  }, [member.id]);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.loading && !q.data) return <Loading />;
  if (!q.data) return <Screen><Card><T>No open shift.</T><Button title="Open shift" onPress={() => router.replace('/(app)/shift/open')} /></Card></Screen>;
  const { shift, summary } = q.data;
  const countedPaise = parseRupees(counted);
  const diff = countedPaise === null ? null : countedPaise - summary.expected;

  async function submit() {
    if (countedPaise === null || countedPaise < 0) return setError('Count the cash and enter the amount');
    const go = async () => {
      setBusy(true);
      try {
        await closeShift({ shift, countedCashPaise: countedPaise, notes: notes || undefined });
        void syncNow();
        router.replace('/(app)/shift');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    };
    if (diff !== null && diff !== 0) {
      Alert.alert(diff < 0 ? `Short by ${formatPaise(-diff)}` : `Excess of ${formatPaise(diff)}`, 'Recount once before closing. Common causes: a sale not recorded, change given wrongly, an expense not entered.', [{ text: 'Recount' }, { text: 'Close anyway', style: 'destructive', onPress: () => void go() }]);
    } else await go();
  }

  const Line = ({ label, paise, sign }: { label: string; paise: number; sign: '+' | '−' | '' }) => (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <T color={colors.textMuted}>{sign} {label}</T>
      <Money paise={paise} />
    </Row>
  );

  return (
    <Screen>
      <ErrorBanner message={error} />
      <Card>
        <T variant="label">Expected cash in drawer</T>
        <Money paise={summary.expected} variant="display" color={colors.cash} />
        <View style={{ marginTop: 8 }}>
          <Line label="Opening cash" paise={summary.opening} sign="" />
          <Line label="Cash sales" paise={summary.cashSales} sign="+" />
          <Line label="Khata collected (cash)" paise={summary.cashReceived} sign="+" />
          <Line label="Cash refunds" paise={summary.cashRefunds} sign="−" />
          <Line label="Cash expenses" paise={summary.cashExpenses} sign="−" />
          <Line label="Paid to suppliers (cash)" paise={summary.cashPaidOut} sign="−" />
        </View>
      </Card>
      <Card>
        <T variant="label">Not part of cash</T>
        <Line label="UPI sales (verify in UPI app)" paise={summary.upiSales} sign="" />
        <Line label="UPI khata collections" paise={summary.upiReceived} sign="" />
        <Line label="Udhaar given (credit)" paise={summary.creditSales} sign="" />
        {q.data.upiPending > 0 ? <Button title={`${q.data.upiPending} UPI payment(s) still unverified — verify`} variant="ghost" size="sm" onPress={() => router.push('/(app)/upi')} /> : null}
      </Card>
      <Card tone={diff === null ? 'default' : diff === 0 ? 'success' : 'danger'}>
        <MoneyField label="Cash counted now" valueRupees={counted} onChangeRupees={setCounted} autoFocus big />
        {diff !== null ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="heading">{diff === 0 ? 'Balanced ✓' : diff < 0 ? 'Short' : 'Excess'}</T>
            <Money paise={diff} variant="heading" sign color={diff === 0 ? colors.success : colors.danger} />
          </Row>
        ) : null}
        <Field label="Notes (handover, reasons)" value={notes} onChangeText={setNotes} multiline />
        <Button title="Close shift" size="lg" variant={diff === 0 ? 'primary' : 'danger'} onPress={submit} loading={busy} />
      </Card>
      <SectionTitle>Shift</SectionTitle>
      <T color={colors.textMuted}>{summary.salesCount} bills · total sales {formatPaise(summary.salesTotal)} · opened {new Date(shift.opened_at).toLocaleString()}</T>
    </Screen>
  );
}
