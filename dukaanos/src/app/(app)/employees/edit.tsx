import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { DEFAULT_EMPLOYEE_PERMISSIONS, type MemberPermissions } from '@/core/permissions';
import { useSession } from '@/features/session';
import { createEmployee, listMembersServer, setEmployeePin, updateEmployee } from '@/lib/repos/members';
import { Button, Card, Chip, ErrorBanner, Field, Loading, Row, Screen, SectionTitle, T } from '@/ui';
import { colors, spacing } from '@/ui/theme';

const PERM_LABELS: { key: keyof MemberPermissions; label: string; hint: string }[] = [
  { key: 'can_discount', label: 'Give discounts', hint: 'Up to the % below' },
  { key: 'can_refund', label: 'Refunds', hint: 'Return money for a sale' },
  { key: 'can_receive_stock', label: 'Receive stock', hint: 'Record supplier deliveries and pay suppliers' },
  { key: 'can_adjust_stock', label: 'Adjust stock', hint: 'Damage, expiry, physical counts' },
  { key: 'can_record_expense', label: 'Record expenses', hint: 'Chai, transport, etc.' },
  { key: 'can_view_purchase_price', label: 'See purchase prices', hint: 'Shows margins' },
];

export default function EditEmployeeScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { shop } = useSession();
  const [loading, setLoading] = useState(Boolean(id));
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'employee' | 'admin'>('employee');
  const [active, setActive] = useState(true);
  const [perms, setPerms] = useState<MemberPermissions>(DEFAULT_EMPLOYEE_PERMISSIONS);
  const [pin, setPin] = useState('');
  const [memberId, setMemberId] = useState<string | undefined>(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void (async () => {
      try {
        const all = await listMembersServer();
        const m = all.find((x) => x.id === id);
        if (m) {
          setName(m.display_name); setPhone(m.phone ?? ''); setRole(m.role === 'admin' ? 'admin' : 'employee'); setActive(m.is_active);
          setPerms({ ...DEFAULT_EMPLOYEE_PERMISSIONS, ...(m.permissions as Partial<MemberPermissions>) });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function save() {
    if (name.trim().length < 2) return setError('Name is required');
    setBusy(true); setError(null); setOk(null);
    try {
      if (memberId) {
        await updateEmployee(memberId, { display_name: name.trim(), phone: phone.trim() || null, role, is_active: active, permissions: perms });
      } else {
        const m = await createEmployee({ shopId: shop!.id, displayName: name, phone, role, permissions: perms });
        setMemberId(m.id);
      }
      setOk('Saved');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePin() {
    if (!/^\d{4,6}$/.test(pin)) return setError('PIN must be 4–6 digits');
    if (!memberId) return setError('Save the employee first');
    setBusy(true); setError(null);
    try {
      await setEmployeePin(memberId, pin);
      setPin('');
      setOk('PIN set. The employee can now log in with the shop code.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  return (
    <Screen>
      <Stack.Screen options={{ title: memberId ? name || 'Employee' : 'New employee' }} />
      <ErrorBanner message={error} />
      {ok ? <Card tone="success"><T color={colors.success}>{ok}</T></Card> : null}
      <Card>
        <Field label="Name" value={name} onChangeText={setName} autoFocus={!id} />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <T variant="label" style={{ marginBottom: spacing.xs }}>Role</T>
        <Row style={{ marginBottom: spacing.md }}>
          <Chip label="Employee" selected={role === 'employee'} onPress={() => setRole('employee')} />
          <Chip label="Admin (manages products, employees)" selected={role === 'admin'} onPress={() => setRole('admin')} />
        </Row>
        {memberId ? <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}><T>Active</T><Switch value={active} onValueChange={setActive} trackColor={{ true: colors.primary }} /></Row> : null}
        {role === 'employee' ? (
          <>
            <SectionTitle>Permissions</SectionTitle>
            {PERM_LABELS.map((p) => (
              <Row key={p.key} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <Row style={{ flex: 1 }} gap={0}><T>{p.label}</T><T variant="caption" color={colors.textMuted}>  {p.hint}</T></Row>
                <Switch value={Boolean(perms[p.key])} onValueChange={(v) => setPerms({ ...perms, [p.key]: v })} trackColor={{ true: colors.primary }} />
              </Row>
            ))}
            {perms.can_discount ? <Field label="Max discount %" value={String(perms.max_discount_pct)} onChangeText={(t) => setPerms({ ...perms, max_discount_pct: Number(t.replace(/[^\d.]/g, '')) || 0 })} keyboardType="decimal-pad" /> : null}
          </>
        ) : <T variant="caption" color={colors.textMuted}>Admins have all permissions except they cannot change the owner.</T>}
        <Button title={memberId ? 'Save changes' : 'Create employee'} onPress={save} loading={busy} size="lg" />
      </Card>
      {memberId ? (
        <Card tone="info">
          <T variant="heading">Set login PIN</T>
          <T variant="caption" color={colors.textMuted}>4–6 digits. Tell the employee privately. 5 wrong attempts lock the PIN for 15 minutes.</T>
          <Field value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secureTextEntry placeholder="••••" style={{ marginTop: spacing.md }} />
          <Button title="Set PIN" onPress={savePin} loading={busy} variant="accent" />
        </Card>
      ) : null}
      <Button title="Back to employees" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
