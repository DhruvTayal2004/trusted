import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { lookupShopForPin, signInWithPin } from '@/features/session';
import { kvGet, kvSet } from '@/lib/db';
import { Button, Card, Chip, ErrorBanner, Field, Row, Screen, Spacer, T } from '@/ui';
import { colors, radius, touch } from '@/ui/theme';

/**
 * Employee PIN login. Shop code is the short code the owner shares (shown in Settings).
 * The code + employee list are remembered on the device so day-to-day login is two taps + PIN.
 */
export default function PinScreen() {
  const [shopCode, setShopCode] = useState('');
  const [shopName, setShopName] = useState<string | null>(null);
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = await kvGet('pin_shop');
      if (saved) {
        const s = JSON.parse(saved) as { code: string; name: string; members: { id: string; display_name: string }[] };
        setShopCode(s.code);
        setShopName(s.name);
        setMembers(s.members);
      }
    })();
  }, []);

  async function lookup() {
    setError(null);
    setBusy(true);
    const res = await lookupShopForPin(shopCode);
    setBusy(false);
    if ('error' in res) {
      setError(res.error);
      return;
    }
    setShopName(res.shop_name);
    setMembers(res.members);
    await kvSet('pin_shop', JSON.stringify({ code: shopCode.trim(), name: res.shop_name, members: res.members }));
  }

  async function submit(fullPin: string) {
    if (!memberId) return;
    setBusy(true);
    setError(null);
    const err = await signInWithPin(shopCode, memberId, fullPin);
    setBusy(false);
    if (err) {
      setError(err);
      setPin('');
    }
  }

  function press(d: string) {
    if (busy) return;
    if (d === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    const next = pin + d;
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  return (
    <Screen>
      <ErrorBanner message={error} />
      {!shopName ? (
        <Card>
          <T variant="heading">Shop code</T>
          <T color={colors.textMuted}>Ask the owner for the 6-letter shop code (Settings → Shop code).</T>
          <Spacer />
          <Field value={shopCode} onChangeText={(t) => setShopCode(t.toUpperCase())} autoCapitalize="characters" placeholder="e.g. SHARMA" />
          <Button title="Find shop" onPress={lookup} loading={busy} />
        </Card>
      ) : (
        <>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="heading">{shopName}</T>
            <Button title="Change" variant="ghost" size="sm" onPress={() => { setShopName(null); setMemberId(null); }} />
          </Row>
          <T variant="label" style={{ marginTop: 16 }}>Who are you?</T>
          <Row style={{ flexWrap: 'wrap', marginTop: 8 }}>
            {members.map((m) => (
              <Chip key={m.id} label={m.display_name} selected={memberId === m.id} onPress={() => { setMemberId(m.id); setPin(''); }} />
            ))}
            {members.length === 0 ? <T color={colors.textMuted}>No employees yet. Ask the owner to add you.</T> : null}
          </Row>
          {memberId ? (
            <>
              <T variant="label" style={{ marginTop: 24 }}>Enter PIN</T>
              <Row style={{ justifyContent: 'center', marginVertical: 16 }} gap={16}>
                {[0, 1, 2, 3].map((i) => <View key={i} style={[styles.dot, pin.length > i && styles.dotFilled]} />)}
              </Row>
              <View style={styles.pad}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => (
                  <Pressable key={i} disabled={!d} onPress={() => press(d)} style={({ pressed }) => [styles.key, !d && { opacity: 0 }, pressed && { backgroundColor: colors.surfaceAlt }]}>
                    <T variant="title">{d}</T>
                  </Pressable>
                ))}
              </View>
              <Button title="Login with 5–6 digit PIN" variant="ghost" onPress={() => submit(pin)} disabled={pin.length < 5} loading={busy} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.primary },
  dotFilled: { backgroundColor: colors.primary },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 },
  key: { width: '28%', height: touch.big, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
});
