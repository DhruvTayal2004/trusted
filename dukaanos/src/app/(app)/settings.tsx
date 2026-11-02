import { useState } from 'react';
import { Share } from 'react-native';
import { parseRupees } from '@/core/money';
import { sessionStore, useSession } from '@/features/session';
import { supabase } from '@/lib/supabase';
import { Button, Card, ErrorBanner, Field, MoneyField, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

export default function SettingsScreen() {
  const { shop } = useSession();
  const settings = (shop?.settings ?? {}) as { shop_code?: string; cash_alert_threshold_paise?: number; reminder_threshold_paise?: number };
  const [name, setName] = useState(shop?.name ?? '');
  const [phone, setPhone] = useState(shop?.phone ?? '');
  const [cashAlert, setCashAlert] = useState(String((settings.cash_alert_threshold_paise ?? 5000) / 100));
  const [reminder, setReminder] = useState(String((settings.reminder_threshold_paise ?? 50000) / 100));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    const cash = parseRupees(cashAlert);
    const rem = parseRupees(reminder);
    if (cash === null || rem === null) return setError('Enter valid amounts');
    setBusy(true); setError(null); setOk(false);
    const next = { ...settings, cash_alert_threshold_paise: cash, reminder_threshold_paise: rem };
    const { error: e } = await supabase.from('shops').update({ name: name.trim(), phone: phone.trim() || null, settings: next }).eq('id', shop!.id);
    setBusy(false);
    if (e) return setError(e.message);
    sessionStore.set({ shop: { ...shop!, name: name.trim(), phone: phone.trim() || null, settings: next } });
    setOk(true);
  }

  return (
    <Screen>
      <Card tone="info">
        <T variant="label">Shop code for employee login</T>
        <T variant="display">{settings.shop_code ?? '—'}</T>
        <Button title="Share code" variant="ghost" size="sm" onPress={() => Share.share({ message: `DukaanOS shop code for ${shop?.name}: ${settings.shop_code}. Open the app → Employee login with PIN.` })} />
      </Card>
      <Card>
        <ErrorBanner message={error} />
        {ok ? <T color={colors.success}>Saved</T> : null}
        <Field label="Shop name" value={name} onChangeText={setName} />
        <Field label="Owner WhatsApp number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" hint="Daily reports and alerts go here (when WhatsApp is connected)" />
        <MoneyField label="Alert when cash difference is at least" valueRupees={cashAlert} onChangeRupees={setCashAlert} />
        <MoneyField label="Remind customers when udhaar is at least" valueRupees={reminder} onChangeRupees={setReminder} />
        <Button title="Save" onPress={save} loading={busy} />
      </Card>
    </Screen>
  );
}
