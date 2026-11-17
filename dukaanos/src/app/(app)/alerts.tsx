import { useState } from 'react';
import { View } from 'react-native';
import { callFunction } from '@/lib/ai';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@/features/useQuery';
import { Button, Card, Empty, ErrorBanner, ListRow, Pill, Screen, T } from '@/ui';
import { colors } from '@/ui/theme';

const TEMPLATE: Record<string, string> = { daily_report: 'Daily report', cash_discrepancy: 'Cash difference alert', low_stock: 'Low stock', payment_reminder: 'Payment reminder', shift_closed: 'Shift closed' };

/** Notification outbox with honest delivery status. Nothing here claims delivery unless the provider confirmed it. */
export default function AlertsScreen() {
  const q = useQuery(async () => {
    const { data, error } = await supabase.from('notifications_outbox').select('id, template, recipient, status, provider, error, created_at, sent_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    return data;
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function queue() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc('queue_daily_notifications');
    if (error) setMsg(error.message); else setMsg(`${data} notification(s) queued`);
    setBusy(false);
    await q.refresh();
  }
  async function send() {
    setBusy(true); setMsg(null);
    try {
      const r = await callFunction<{ sent: number; skipped: number; failed: number; provider: string; configured: boolean }>('notify', { limit: 50 });
      setMsg(r.configured ? `Sent ${r.sent}, failed ${r.failed} via ${r.provider}` : `WhatsApp is NOT connected (no credentials). ${r.skipped} message(s) marked "not delivered". Set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN on the server to enable.`);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
    await q.refresh();
  }

  return (
    <Screen refreshing={q.loading} onRefresh={q.refresh}>
      <ErrorBanner message={q.error} onRetry={q.refresh} />
      <Card tone="info">
        <T variant="heading">WhatsApp alerts</T>
        <T variant="caption" color={colors.textMuted}>Daily report, cash-difference alerts (automatic at shift close), low stock and customer reminders are queued here and sent through the WhatsApp Business API when connected.</T>
        <Button title="Queue today's report, low stock & reminders" variant="secondary" onPress={queue} loading={busy} />
        <Button title="Send queued now" onPress={send} loading={busy} />
        {msg ? <T color={colors.textMuted}>{msg}</T> : null}
      </Card>
      {q.data && q.data.length === 0 ? <Empty title="No notifications yet" /> : null}
      {(q.data ?? []).map((n) => (
        <ListRow key={n.id} title={TEMPLATE[n.template] ?? n.template} subtitle={`${n.recipient || 'no number'} · ${new Date(n.created_at).toLocaleString()}${n.error ? ' · ' + n.error : ''}`}
          right={<View><Pill label={n.status === 'sent' ? 'Delivered to API' : n.status === 'queued' ? 'Queued' : n.status === 'skipped_no_provider' ? 'Not delivered' : 'Failed'} tone={n.status === 'sent' ? 'success' : n.status === 'queued' ? 'info' : 'danger'} /></View>} />
      ))}
    </Screen>
  );
}
