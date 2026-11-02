import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { parseRupees } from '@/core/money';
import { isManager } from '@/core/permissions';
import { useMember, useSession } from '@/features/session';
import { recordKhataEntry, saveCustomer } from '@/lib/repos/customers';
import { Button, Card, ErrorBanner, Field, MoneyField, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function NewCustomerScreen() {
  const { shop } = useSession();
  const member = useMember();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length < 2) return setError('Name is required');
    const openingPaise = opening.trim() ? parseRupees(opening) : 0;
    if (openingPaise === null) return setError('Invalid opening balance');
    setBusy(true);
    try {
      const c = await saveCustomer(shop!.id, { name, phone });
      if (openingPaise && isManager(member)) {
        await recordKhataEntry({ shopId: shop!.id, memberId: member.id, customerId: c.id, entryType: 'opening_balance', amountPaise: openingPaise, note: 'Opening balance from old khata' });
      }
      if (returnTo === 'sale') router.replace({ pathname: '/(app)/sale/new', params: { customerId: c.id } });
      else router.replace({ pathname: '/(app)/customers/[id]', params: { id: c.id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <ErrorBanner message={error} />
        <Field label="Customer name" value={name} onChangeText={setName} placeholder="Ramesh Kumar" autoFocus />
        <Field label="Phone (for reminders)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98xxxxxxxx" />
        {isManager(member) ? (
          <>
            <MoneyField label="Opening balance (old udhaar, optional)" valueRupees={opening} onChangeRupees={setOpening} />
            <T variant="caption" color={colors.textMuted} style={{ marginBottom: 12 }}>Kept separate from day-to-day transactions so the old notebook total stays traceable.</T>
          </>
        ) : null}
        <Button title="Save customer" onPress={submit} loading={busy} size="lg" />
      </Card>
    </Screen>
  );
}
