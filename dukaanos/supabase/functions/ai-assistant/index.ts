/**
 * Business assistant. Hindi / Hinglish / English questions → deterministic SQL → phrased answer.
 *
 *  POST { question, history?: [{role, content}] }
 *  → { answer, data_used: [...], confidence: 'verified'|'estimate'|'unavailable', provider }
 *
 * The model NEVER computes money. Step 1: model picks which read-only report functions to call
 * (intent + parameters). Step 2: we run them as the calling user (RLS applies). Step 3: model
 * phrases the numbers it was given and must cite them. Owners/admins only.
 */
import { AiNotConfigured, getProvider, type JsonSchema } from '../_shared/ai.ts';
import { handle, HttpError, json, requireMember } from '../_shared/supabase.ts';

const PLAN_SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['calls', 'language', 'needs_clarification', 'clarification_question'],
  properties: {
    language: { type: 'string', enum: ['hi', 'hinglish', 'en'] },
    needs_clarification: { type: 'boolean' },
    clarification_question: { type: ['string', 'null'] },
    calls: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['fn', 'args'],
        properties: {
          fn: { type: 'string', enum: ['daily_summary', 'sales_summary_range', 'shift_cash_summary', 'customer_statement', 'product_stock_report', 'anomaly_report', 'find_customer', 'find_product', 'supplier_dues', 'recent_shifts'] },
          args: { type: 'object', additionalProperties: false, required: ['date', 'from', 'to', 'name', 'days', 'shift_id'],
            properties: { date: { type: ['string', 'null'] }, from: { type: ['string', 'null'] }, to: { type: ['string', 'null'] }, name: { type: ['string', 'null'] }, days: { type: ['integer', 'null'] }, shift_id: { type: ['string', 'null'] } } },
        },
      },
    },
  },
};

const PLAN_SYSTEM = (today: string) => `You plan data lookups for an Indian kirana shop owner's question. Today is ${today} (shop local date).
Available read-only functions (all return verified numbers from the database):
- daily_summary(date) — sales, cash/UPI/credit split, expenses, khata collected, outstanding, low stock, shifts & cash differences for one day
- sales_summary_range(from,to) — totals + per-day + top products for a date range (use for hafta/week, mahina/month)
- shift_cash_summary(shift_id) — expected cash for a shift; prefer recent_shifts first to get ids
- recent_shifts(days) — closed shifts with employee name and cash difference
- customer_statement(name) — a customer's balance + entries (use find_customer resolution; pass the name)
- find_customer(name) / find_product(name) — resolve a Hinglish name to records
- product_stock_report() — low stock, negative stock
- anomaly_report(days) — unusual patterns (cash differences, big discounts, refunds, adjustments)
- supplier_dues() — what the shop owes suppliers
Map Hinglish: "aaj" today, "kal" yesterday (or tomorrow — ask if ambiguous for future), "is hafte" this week (Mon..today), "pichle hafte" last week, "is mahine" this month, "udhaar/baaki" customer balance, "kitna cash hona chahiye" shift expected cash, "kitna bacha" stock, "kharcha" expenses, "kisne/kis employee" per-employee or shift.
Fill every args key (use null when not applicable). Ask for clarification only when a name is missing for a customer/product question.`;

const ANSWER_SYSTEM = `You are DukaanOS assistant for a kirana shop owner. Answer in the same language as the question (Hindi/Hinglish/English), short, like a trusted munim.
STRICT RULES:
- Use ONLY the numbers in DATA. Never calculate new totals yourself except simple sums that are explicitly present. Never invent a figure.
- Amounts in DATA are in paise unless the key says rupees; convert to ₹ by dividing by 100 and format Indian style (₹1,23,456).
- Start with the direct answer. Then 1–3 supporting lines. If DATA is empty or has an error for what was asked, say the information is not available ("yeh jaankari abhi uplabdh nahi hai") — do not guess.
- Cash differences, stock differences and anomalies are observations, not accusations. Never say or imply an employee stole; suggest checking.
- End with a one-word tag on its own line: VERIFIED (all figures from DATA), ESTIMATE (any approximation), or UNAVAILABLE.`;

Deno.serve(handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  const { client, member } = await requireMember(req);
  if (!['owner', 'admin'].includes(member.role)) throw new HttpError(403, 'Owner or admin required');
  const body = (await req.json()) as { question?: string; history?: { role: 'user' | 'assistant'; content: string }[] };
  const question = (body.question ?? '').trim();
  if (!question) throw new HttpError(400, 'question required');

  const provider = getProvider();
  if (provider.name === 'none') return json({ answer: 'AI assistant is not connected on the server (no API key). Reports still work from the Reports screen.', confidence: 'unavailable', not_configured: true, data_used: [] }, 200);

  const { data: shop } = await client.from('shops').select('timezone').eq('id', member.shop_id).single();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: shop?.timezone ?? 'Asia/Kolkata' });

  let plan: { calls: { fn: string; args: Record<string, string | number | null> }[]; needs_clarification: boolean; clarification_question: string | null; language: string };
  try {
    const p = await provider.chat({ system: PLAN_SYSTEM(today), messages: [...(body.history ?? []).slice(-6), { role: 'user', content: question }], schema: PLAN_SCHEMA, maxTokens: 1500 });
    plan = p.json as typeof plan;
    if (!plan || !Array.isArray(plan.calls)) throw new Error('bad plan');
  } catch (e) {
    if (e instanceof AiNotConfigured) return json({ answer: e.message, confidence: 'unavailable', data_used: [] });
    throw new HttpError(502, 'Could not understand the question: ' + (e as Error).message);
  }
  if (plan.needs_clarification && plan.clarification_question) {
    return json({ answer: plan.clarification_question, confidence: 'unavailable', data_used: [], clarification: true, provider: provider.name });
  }

  const dataUsed: { fn: string; args: Record<string, unknown>; result: unknown; error?: string }[] = [];
  for (const call of plan.calls.slice(0, 6)) {
    const a = call.args ?? {};
    try {
      let result: unknown;
      switch (call.fn) {
        case 'daily_summary': result = unwrap(await client.rpc('daily_summary', { p_date: a.date ?? today })); break;
        case 'sales_summary_range': result = unwrap(await client.rpc('sales_summary_range', { p_from: a.from ?? today, p_to: a.to ?? today })); break;
        case 'shift_cash_summary': result = unwrap(await client.rpc('shift_cash_summary', { p_shift_id: a.shift_id })); break;
        case 'recent_shifts': result = unwrap(await client.from('shifts').select('id, status, opened_at, closed_at, expected_cash_paise, counted_cash_paise, cash_difference_paise, shop_members(display_name)').order('opened_at', { ascending: false }).limit(Math.min(Number(a.days ?? 7) * 3, 30))); break;
        case 'find_customer': result = unwrap(await client.from('customers').select('id, name, phone, balance_paise').ilike('name', `%${String(a.name ?? '')}%`).limit(5)); break;
        case 'customer_statement': {
          const found = unwrap(await client.from('customers').select('id, name').ilike('name', `%${String(a.name ?? '')}%`).limit(3)) as { id: string; name: string }[];
          result = found.length ? await Promise.all(found.map(async (c) => unwrap(await client.rpc('customer_statement', { p_customer_id: c.id, p_limit: 15 })))) : { error: 'no customer matched ' + a.name };
          break;
        }
        case 'find_product': result = unwrap(await client.from('products').select('id, name, name_hi, unit, stock_qty, min_stock_qty, selling_price_paise').or(`name.ilike.%${String(a.name ?? '')}%,name_hi.ilike.%${String(a.name ?? '')}%,aliases.cs.{${String(a.name ?? '').toLowerCase()}}`).limit(5)); break;
        case 'product_stock_report': result = unwrap(await client.rpc('product_stock_report')); break;
        case 'anomaly_report': result = unwrap(await client.rpc('anomaly_report', { p_days: a.days ?? 7 })); break;
        case 'supplier_dues': result = unwrap(await client.from('suppliers').select('name, balance_paise').gt('balance_paise', 0).order('balance_paise', { ascending: false }).limit(20)); break;
        default: result = { error: 'unknown function' };
      }
      dataUsed.push({ fn: call.fn, args: a, result });
    } catch (e) {
      dataUsed.push({ fn: call.fn, args: a, result: null, error: (e as Error).message });
    }
  }

  const answer = await provider.chat({
    system: ANSWER_SYSTEM,
    messages: [{ role: 'user', content: `QUESTION: ${question}\nTODAY: ${today}\nDATA (JSON, amounts in paise):\n${JSON.stringify(dataUsed).slice(0, 60000)}` }],
    maxTokens: 1200,
  });
  const text = answer.text.trim();
  const tag = /\b(VERIFIED|ESTIMATE|UNAVAILABLE)\s*$/.exec(text)?.[1] ?? (dataUsed.some((d) => d.error) ? 'UNAVAILABLE' : 'VERIFIED');
  return json({ answer: text.replace(/\n?\s*(VERIFIED|ESTIMATE|UNAVAILABLE)\s*$/, '').trim(), confidence: tag.toLowerCase(), data_used: dataUsed, provider: provider.name, model: provider.model });
}));

function unwrap<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
