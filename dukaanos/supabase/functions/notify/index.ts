/**
 * Notification dispatcher. Drains `notifications_outbox` for the caller's shop.
 *
 *  POST { limit?: number }   (owner/admin JWT)  → { sent, skipped, failed, provider }
 *
 * Provider abstraction: WhatsAppCloudProvider (Meta WhatsApp Business Cloud API) when
 * WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set; otherwise TestProvider, which
 * renders the message and marks the row `skipped_no_provider` — it NEVER pretends delivery.
 */
import { adminClient, env, handle, HttpError, json, requireMember } from '../_shared/supabase.ts';

interface Notification { id: string; template: string; recipient: string; payload: Record<string, unknown> }
interface SendResult { ok: boolean; providerMessageId?: string; error?: string; skipped?: boolean }
interface NotificationProvider { name: string; send(to: string, text: string): Promise<SendResult> }

const rupees = (p: unknown) => `₹${(Number(p ?? 0) / 100).toLocaleString('en-IN')}`;

/** Message text per template — plain text so it works with any channel (WhatsApp, SMS, in-app). */
export function render(n: Notification): string {
  const p = n.payload;
  switch (n.template) {
    case 'daily_report':
      return `DukaanOS daily report ${p.date}\nSales: ${rupees(p.sales_total_paise)} (${p.sales_count} bills)\nCash ${rupees(p.cash_sales_paise)} · UPI ${rupees(p.upi_sales_paise)} · Udhaar ${rupees(p.credit_sales_paise)}\nKhata collected: ${rupees(p.khata_collected_paise)}\nExpenses: ${rupees(p.expenses_paise)}\nCustomers owe: ${rupees(p.outstanding_customer_paise)} · We owe suppliers: ${rupees(p.outstanding_supplier_paise)}\nLow stock items: ${p.low_stock_count}`;
    case 'cash_discrepancy':
      return `DukaanOS: cash difference in ${p.member}'s shift.\nExpected ${rupees(p.expected_paise)}, counted ${rupees(p.counted_paise)} → ${Number(p.difference_paise) < 0 ? 'short' : 'excess'} ${rupees(Math.abs(Number(p.difference_paise)))}.\nPlease review the shift in the app.`;
    case 'low_stock': {
      const items = ((p.low_stock as { name: string; stock_qty: string; unit: string; min_stock_qty: string }[]) ?? []).slice(0, 10).map((i) => `• ${i.name}: ${i.stock_qty} ${i.unit} (min ${i.min_stock_qty})`).join('\n');
      return `DukaanOS low stock:\n${items}`;
    }
    case 'payment_reminder':
      return `Namaste ${p.customer} ji, aapka baaki udhaar ${rupees(p.balance_paise)} hai. Kripya jald bhugtan karein. Dhanyavaad 🙏`;
    case 'shift_closed':
      return `DukaanOS: ${p.member} closed their shift. Sales ${rupees(p.sales_paise)}, cash difference ${rupees(p.difference_paise)}.`;
    default:
      return `DukaanOS: ${n.template} ${JSON.stringify(p).slice(0, 500)}`;
  }
}

class WhatsAppCloudProvider implements NotificationProvider {
  name = 'whatsapp_cloud';
  constructor(private phoneNumberId: string, private token: string) {}
  async send(to: string, text: string): Promise<SendResult> {
    const digits = to.replace(/\D/g, '');
    const msisdn = digits.length === 10 ? '91' + digits : digits;
    if (msisdn.length < 11) return { ok: false, error: 'Invalid phone number' };
    const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: msisdn, type: 'text', text: { body: text } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `WhatsApp API ${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
    return { ok: true, providerMessageId: body?.messages?.[0]?.id };
  }
}

/** No credentials: log the rendered message so it is visible in function logs and the Alerts screen. */
class TestProvider implements NotificationProvider {
  name = 'test';
  async send(to: string, text: string): Promise<SendResult> {
    console.log(`[notify:test] would send to ${to}:\n${text}`);
    return { ok: false, skipped: true, error: 'No WhatsApp credentials configured — message NOT delivered' };
  }
}

export function getNotificationProvider(): NotificationProvider {
  const id = env('WHATSAPP_PHONE_NUMBER_ID');
  const token = env('WHATSAPP_ACCESS_TOKEN');
  return id && token ? new WhatsAppCloudProvider(id, token) : new TestProvider();
}

Deno.serve(handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  const { member } = await requireMember(req);
  if (!['owner', 'admin'].includes(member.role)) throw new HttpError(403, 'Owner or admin required');
  const { limit = 20 } = (await req.json().catch(() => ({}))) as { limit?: number };
  const admin = adminClient();
  const provider = getNotificationProvider();
  const { data: rows, error } = await admin.from('notifications_outbox').select('id, template, recipient, payload').eq('shop_id', member.shop_id).eq('status', 'queued').order('created_at').limit(Math.min(limit, 100));
  if (error) throw new HttpError(500, error.message);
  let sent = 0, skipped = 0, failed = 0;
  for (const n of (rows ?? []) as Notification[]) {
    const text = render(n);
    if (!n.recipient) {
      await admin.from('notifications_outbox').update({ status: 'failed', provider: provider.name, error: 'No recipient phone number' }).eq('id', n.id);
      failed++;
      continue;
    }
    const r = await provider.send(n.recipient, text);
    if (r.ok) { sent++; await admin.from('notifications_outbox').update({ status: 'sent', provider: provider.name, provider_message_id: r.providerMessageId ?? null, sent_at: new Date().toISOString(), error: null }).eq('id', n.id); }
    else if (r.skipped) { skipped++; await admin.from('notifications_outbox').update({ status: 'skipped_no_provider', provider: provider.name, error: r.error ?? null }).eq('id', n.id); }
    else { failed++; await admin.from('notifications_outbox').update({ status: 'failed', provider: provider.name, error: r.error ?? null }).eq('id', n.id); }
  }
  return json({ sent, skipped, failed, provider: provider.name, configured: provider.name !== 'test' });
}));
