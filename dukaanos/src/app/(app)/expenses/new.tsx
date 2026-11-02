import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image } from 'react-native';
import { parseRupees } from '@/core/money';
import { useMember, useSession } from '@/features/session';
import { createExpense, listExpenseCategories } from '@/lib/repos/expenses';
import { currentShift } from '@/lib/repos/shifts';
import { uploadImage } from '@/lib/storage';
import { syncNow } from '@/lib/sync/engine';
import type { ExpenseCategory } from '@/lib/repos/types';
import { Button, Card, Chip, ErrorBanner, Field, MoneyField, Row, Screen, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

export default function NewExpenseScreen() {
  const { shop } = useSession();
  const member = useMember();
  const [cats, setCats] = useState<ExpenseCategory[]>([]);
  const [cat, setCat] = useState<ExpenseCategory | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'upi'>('cash');
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void listExpenseCategories().then(setCats); }, []);

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return setError('Camera permission needed for receipt photo');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 });
    if (!res.canceled && res.assets[0]) setPhoto(res.assets[0].uri);
  }

  async function submit() {
    const paise = parseRupees(amount);
    if (!paise || paise <= 0) return setError('Enter the amount');
    if (!cat && !note.trim()) return setError('Pick a category or write what it was for');
    setBusy(true);
    setError(null);
    try {
      let receiptPath: string | null = null;
      if (photo) {
        // Upload is best-effort: offline → expense still saved, photo path stays null and is noted.
        receiptPath = await uploadImage('receipts', `${shop!.id}/${Date.now()}.jpg`, photo).catch(() => null);
      }
      const shift = await currentShift(member.id);
      const e = await createExpense({ shopId: shop!.id, memberId: member.id, shiftId: shift?.id ?? null, role: member.role, category: cat, categoryName: cat ? undefined : note.trim(), amountPaise: paise, paidMethod: method, note: note || undefined, receiptPath: receiptPath ?? (photo ? 'upload_pending' : null) });
      void syncNow();
      router.back();
      if (e.status === 'pending_approval') setTimeout(() => alert('Expense saved — waiting for owner approval'), 100);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <ErrorBanner message={error} />
        <MoneyField label="Amount" valueRupees={amount} onChangeRupees={setAmount} autoFocus big />
        <T variant="label" style={{ marginBottom: spacing.xs }}>Category</T>
        <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
          {cats.map((c) => <Chip key={c.id} label={`${c.name}${c.requires_approval ? ' *' : ''}`} selected={cat?.id === c.id} onPress={() => setCat(cat?.id === c.id ? null : c)} />)}
        </Row>
        <T variant="label" style={{ marginBottom: spacing.xs }}>Paid from</T>
        <Row style={{ marginBottom: spacing.md }}>
          <Chip label="💵 Cash drawer" selected={method === 'cash'} onPress={() => setMethod('cash')} color={colors.cash} />
          <Chip label="📱 UPI" selected={method === 'upi'} onPress={() => setMethod('upi')} color={colors.upi} />
        </Row>
        <Field label="Note" value={note} onChangeText={setNote} placeholder="e.g. tempo bhada" />
        {photo ? <Image source={{ uri: photo }} style={{ width: '100%', height: 160, borderRadius: 12, marginBottom: spacing.md }} /> : null}
        <Button title={photo ? 'Retake receipt photo' : '📷 Receipt photo (optional)'} variant="secondary" onPress={takePhoto} />
        <Button title="Save expense" size="lg" onPress={submit} loading={busy} />
        <T variant="caption" color={colors.textMuted}>Cash expenses reduce the expected cash for your shift. * needs owner approval.</T>
      </Card>
    </Screen>
  );
}
