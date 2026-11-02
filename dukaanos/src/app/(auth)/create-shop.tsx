import { useState } from 'react';
import { createShop, signOut } from '@/features/session';
import { Button, Card, ErrorBanner, Field, Screen, Spacer, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function CreateShopScreen() {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim().length < 2 || owner.trim().length < 2) {
      setError('Shop name and your name are required');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await createShop(name.trim(), owner.trim(), phone.trim());
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <Screen>
      <T variant="title">Create your shop</T>
      <T color={colors.textMuted}>This takes 30 seconds. You can add employees and products next.</T>
      <Spacer />
      <Card>
        <ErrorBanner message={error} />
        <Field label="Shop name" value={name} onChangeText={setName} placeholder="Sharma Kirana Store" />
        <Field label="Your name" value={owner} onChangeText={setOwner} placeholder="Sharma ji" />
        <Field label="WhatsApp number (for reports)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98xxxxxxxx" />
        <Button title="Create shop" onPress={submit} loading={busy} size="lg" />
      </Card>
      <Button title="Sign out" variant="ghost" onPress={() => void signOut()} />
    </Screen>
  );
}
