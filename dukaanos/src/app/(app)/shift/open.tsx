import { router } from 'expo-router';
import { useState } from 'react';
import { parseRupees } from '@/core/money';
import { useMember, useSession } from '@/features/session';
import { openShift } from '@/lib/repos/shifts';
import { syncNow } from '@/lib/sync/engine';
import { Button, Card, ErrorBanner, MoneyField, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function OpenShiftScreen() {
  const { shop } = useSession();
  const member = useMember();
  const [cash, setCash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const paise = parseRupees(cash || '0');
    if (paise === null || paise < 0) return setError('Enter the cash currently in the drawer');
    setBusy(true);
    try {
      await openShift({ shopId: shop!.id, memberId: member.id, openingCashPaise: paise });
      void syncNow();
      router.replace('/(app)/(tabs)/home');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Card>
        <T variant="heading">Count the drawer</T>
        <T color={colors.textMuted} style={{ marginBottom: 16 }}>Enter the cash in the drawer right now. At closing, DukaanOS calculates what should be there.</T>
        <ErrorBanner message={error} />
        <MoneyField label="Opening cash" valueRupees={cash} onChangeRupees={setCash} autoFocus big />
        <Button title="Open shift" size="lg" onPress={submit} loading={busy} />
      </Card>
    </Screen>
  );
}
