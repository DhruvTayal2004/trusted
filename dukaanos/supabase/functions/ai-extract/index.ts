/**
 * Notebook page → structured entries for human review.
 *
 *  POST { scan_id }  (caller must be owner/admin of the scan's shop; JWT verified)
 *
 * Reads the page image from the private bucket, asks the vision model for rows with per-row
 * confidence and flags, stores the raw output on notebook_scans.raw_extraction, and inserts
 * notebook_entries with status 'pending'. NOTHING is imported here — the owner reviews first.
 */
import { AiNotConfigured, getProvider, type JsonSchema } from '../_shared/ai.ts';
import { adminClient, handle, HttpError, json, requireMember } from '../_shared/supabase.ts';

const ENTRY_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['page_notes', 'rows'],
  properties: {
    page_notes: { type: 'string', description: 'Short notes: unreadable regions, language, layout, anything the reviewer must know' },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['row_index', 'party_name', 'date', 'amount_rupees', 'direction', 'description', 'confidence', 'flags'],
        properties: {
          row_index: { type: 'integer' },
          party_name: { type: ['string', 'null'], description: 'Customer/supplier name exactly as written (transliterate Devanagari to Latin AND keep original in description). null if absent.' },
          date: { type: ['string', 'null'], description: 'ISO YYYY-MM-DD only if the date is actually written or clearly implied by a page heading; otherwise null. Never guess.' },
          amount_rupees: { type: ['number', 'null'], description: 'Amount in rupees as written. null if unreadable.' },
          direction: { type: 'string', enum: ['debit', 'credit', 'unknown'], description: 'debit = party owes more / goods taken / purchase; credit = payment received (jama). unknown if unclear.' },
          description: { type: ['string', 'null'], description: 'Items or note as written, e.g. "2 kg atta, 1 tel"' },
          confidence: { type: 'number', description: '0..1 confidence that name, amount and direction are all read correctly' },
          flags: { type: 'array', items: { type: 'string', enum: ['unreadable_amount', 'unreadable_name', 'date_missing', 'date_uncertain', 'direction_uncertain', 'struck_through', 'possible_total_row', 'possible_duplicate'] } },
        },
      },
    },
  },
};

const SYSTEM = `You read handwritten Indian shop notebooks (bahi-khata / udhaar register / kharcha diary) written in Hindi, Hinglish or English, often in Devanagari with Indian numerals and ₹ or /- symbols.
Rules:
- Extract one row per ledger line. Do not merge lines. Do not invent names, dates or amounts: if something is not legible, return null and add the matching flag.
- Amounts: "1250/-", "₹1250", "1,250", "१२५०" → 1250. Lakh/thousand words → numeric.
- Dates: accept "12/3", "12-03-24", "12 March", Devanagari dates. If only the day/month is present, use the year from the page heading if present, else null with date_uncertain.
- Direction: words like "jama", "received", "paid", "diya", "✓" → credit. "udhaar", "baaki", "liya", item lists with amounts → debit. Struck-through rows → flag struck_through and set confidence ≤ 0.3.
- Totals/carried-forward rows ("total", "jod", "baki aage") → flag possible_total_row. These must not be imported as transactions.
- Confidence must be honest: unclear digits (1/7, 4/9, 3/8), smudges, overlapping writing → lower it.
Return only JSON matching the schema.`;

const KIND_PROMPT: Record<string, string> = {
  customer_khata: 'This is a CUSTOMER udhaar (credit) page. party_name is the customer. Goods taken on credit are debit; payments received are credit.',
  supplier_khata: 'This is a SUPPLIER account page. party_name is the supplier. Goods/bills received are debit (we owe more); payments we made are credit.',
  expenses: 'This is an EXPENSE diary. party_name may be null; description is the expense (chai, bhada, bijli). Every row is debit.',
  purchases: 'This is a PURCHASE record. party_name is the supplier; description lists items; amount is the bill total. Every row is debit.',
  sales: 'This is a daily SALES record. party_name is usually null; description lists items; amount is the sale total. Rows are debit.',
};

Deno.serve(handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  const { member } = await requireMember(req);
  if (!['owner', 'admin'].includes(member.role)) throw new HttpError(403, 'Owner or admin required');
  const { scan_id } = (await req.json()) as { scan_id?: string };
  if (!scan_id) throw new HttpError(400, 'scan_id required');

  const admin = adminClient();
  const { data: scan, error } = await admin.from('notebook_scans').select('*').eq('id', scan_id).eq('shop_id', member.shop_id).single();
  if (error || !scan) throw new HttpError(404, 'Scan not found');
  if (scan.status === 'extracted' || scan.status === 'reviewed' || scan.status === 'imported') {
    return json({ ok: true, already: true, status: scan.status });
  }
  await admin.from('notebook_scans').update({ status: 'processing', error: null }).eq('id', scan.id);

  try {
    const provider = getProvider();
    if (provider.name === 'none') throw new AiNotConfigured();
    const { data: file, error: dlErr } = await admin.storage.from('notebook-pages').download(scan.image_path);
    if (dlErr || !file) throw new Error('Could not read page image: ' + (dlErr?.message ?? 'missing'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > 14 * 1024 * 1024) throw new Error('Image larger than 14MB');
    const b64 = base64(bytes);
    const mime = (file.type || 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp';

    const out = (await provider.extractFromImage({
      system: SYSTEM,
      prompt: `${KIND_PROMPT[scan.kind] ?? ''}\nPage ${scan.page_number} of a batch. Extract every row.`,
      imageBase64: b64,
      mimeType: mime,
      schema: ENTRY_SCHEMA,
    })) as { page_notes: string; rows: { row_index: number; party_name: string | null; date: string | null; amount_rupees: number | null; direction: 'debit' | 'credit' | 'unknown'; description: string | null; confidence: number; flags: string[] }[] };

    const rows = Array.isArray(out.rows) ? out.rows : [];
    // Flag possible duplicates within the page (same name + amount + date)
    const seen = new Map<string, number>();
    for (const r of rows) {
      const key = `${(r.party_name ?? '').toLowerCase().trim()}|${r.amount_rupees ?? ''}|${r.date ?? ''}`;
      if (seen.has(key) && r.amount_rupees != null) r.flags = [...new Set([...(r.flags ?? []), 'possible_duplicate'])];
      seen.set(key, 1);
    }

    const entries = rows.map((r, i) => ({
      id: crypto.randomUUID(),
      scan_id: scan.id,
      shop_id: scan.shop_id,
      row_index: Number.isInteger(r.row_index) ? r.row_index : i,
      party_name: r.party_name,
      entry_date: isIsoDate(r.date) ? r.date : null,
      amount_paise: r.amount_rupees != null && Number.isFinite(r.amount_rupees) ? Math.round(r.amount_rupees * 100) : null,
      direction: ['debit', 'credit', 'unknown'].includes(r.direction) ? r.direction : 'unknown',
      description: r.description,
      confidence: Math.max(0, Math.min(1, Number(r.confidence) || 0)),
      flags: [...(r.flags ?? []), ...(r.date ? [] : ['date_missing']), ...(r.amount_rupees == null ? ['unreadable_amount'] : [])].filter((v, i2, a) => a.indexOf(v) === i2),
      status: 'pending',
    }));
    if (entries.length) {
      const { error: insErr } = await admin.from('notebook_entries').insert(entries);
      if (insErr) throw new Error('Could not store entries: ' + insErr.message);
    }
    await admin.from('notebook_scans').update({ status: 'extracted', raw_extraction: out, page_notes: out.page_notes ?? null, ai_provider: provider.name, ai_model: provider.model }).eq('id', scan.id);
    return json({ ok: true, rows: entries.length, page_notes: out.page_notes ?? null, provider: provider.name, model: provider.model });
  } catch (e) {
    const msg = (e as Error).message;
    await admin.from('notebook_scans').update({ status: 'failed', error: msg }).eq('id', scan.id);
    if (e instanceof AiNotConfigured) return json({ ok: false, error: msg, not_configured: true }, 503);
    throw new HttpError(500, msg);
  }
}));

function base64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function isIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}
