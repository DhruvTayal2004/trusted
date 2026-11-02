import { router } from 'expo-router';
import { useState } from 'react';
import { parseRupees } from '@/core/money';
import { isManager } from '@/core/permissions';
import { useMember, useSession } from '@/features/session';
import { recordSupplierEntry, saveSupplier } from '@/lib/repos/suppliers';
import { Button, Card, ErrorBanner, Field, MoneyField, Screen } from '@/ui';

export default function NewSupplierScreen() {
  const { shop } = useSession();
  const member = useMember();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [gstin, setGstin] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length < 2) return setError('Name is required');
    const openingPaise = opening.trim() ? parseRupees(opening) : 0;
    if (openingPaise === null) return setError('Invalid opening balance');
    setBusy(true);
    try {
      const s = await saveSupplier(shop!.id, { name, phone, gstin: gstin.trim() || null });
      if (openingPaise && isManager(member)) await recordSupplierEntry({ shopId: shop!.id, memberId: member.id, supplierId: s.id, entryType: 'opening_balance', amountPaise: openingPaise, note: 'Opening balance' });
      router.replace({ pathname: '/(app)/suppliers/[id]', params: { id: s.id } });
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
        <Field label="Supplier name" value={name} onChangeText={setName} autoFocus placeholder="Gupta Wholesale" />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="GSTIN (optional)" value={gstin} onChangeText={setGstin} autoCapitalize="characters" />
        {isManager(member) ? <MoneyField label="Amount we already owe (opening balance, optional)" valueRupees={opening} onChangeRupees={setOpening} /> : null}
        <Button title="Save supplier" onPress={submit} loading={busy} size="lg" />
      </Card>
    </Screen>
  );
}
