/**
 * Voice / Hinglish text → structured order lines for confirmation.
 *
 *  POST multipart: audio (file) [+ text]   or   JSON { text }
 *  → { transcript, items: [{ product_id|null, description, qty, unit, matched_name, alternatives, needs_clarification }], provider }
 *
 * Prices are NOT returned by the model: the app looks them up from the local product catalogue.
 * The model only maps speech to known products (list supplied from the DB) + quantity + unit.
 */
import { AiNotConfigured, getProvider, type JsonSchema } from '../_shared/ai.ts';
import { handle, HttpError, json, requireMember } from '../_shared/supabase.ts';

const SCHEMA: JsonSchema = {
  type: 'object', additionalProperties: false, required: ['items', 'unparsed'],
  properties: {
    unparsed: { type: 'array', items: { type: 'string' }, description: 'Fragments you could not map to any product' },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['spoken', 'product_id', 'qty', 'unit', 'alternatives', 'needs_clarification', 'clarification'],
        properties: {
          spoken: { type: 'string' },
          product_id: { type: ['string', 'null'], description: 'id from the CATALOGUE, or null if no confident match' },
          qty: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], enum: ['kg', 'g', 'l', 'ml', 'pc', 'pkt', 'bag', null] },
          alternatives: { type: 'array', items: { type: 'string' }, description: 'other plausible catalogue ids' },
          needs_clarification: { type: 'boolean' },
          clarification: { type: ['string', 'null'], description: 'Short Hinglish question for the cashier, e.g. "Kaunsa chawal — Basmati ya Sona Masoori?"' },
        },
      },
    },
  },
};

const SYSTEM = `You convert a kirana shop order spoken in Hindi/Hinglish/English into line items.
Quantity words: ek=1, do=2, teen=3, char=4, paanch=5, aadha=0.5, paav=0.25, dedh=1.5, dhai=2.5, sawa=1.25, pauna=0.75. "kilo"=kg, "gram"=g, "packet"=pkt, "litre"=l, "bori"=bag, "piece/nag"=pc.
Match each item to the CATALOGUE by name, name_hi or aliases. If several products match (e.g. two kinds of rice), set needs_clarification=true with alternatives and a short question. If a product is not in the catalogue, product_id=null and put the words in spoken. Never guess prices. If qty is missing, use 1 for packaged items and null for loose items (ask).`;

Deno.serve(handle(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'POST only');
  const { client } = await requireMember(req);
  const provider = getProvider();

  let text = '';
  let transcript: string | null = null;
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const audio = form.get('audio');
    text = String(form.get('text') ?? '');
    if (audio instanceof File && audio.size > 0) {
      if (provider.name === 'none') return json({ error: 'AI not connected', not_configured: true }, 503);
      try {
        transcript = await provider.transcribe({ audioBytes: new Uint8Array(await audio.arrayBuffer()), mimeType: audio.type || 'audio/m4a', language: 'hi', prompt: 'Kirana shop order: chawal, chini, dal, atta, tel, kilo, gram, packet' });
        text = transcript;
      } catch (e) {
        if (e instanceof AiNotConfigured) return json({ error: e.message, not_configured: true, transcript: null }, 503);
        throw e;
      }
    }
  } else {
    text = String(((await req.json()) as { text?: string }).text ?? '');
  }
  if (!text.trim()) throw new HttpError(400, 'No speech or text received');
  if (provider.name === 'none') return json({ transcript, items: [], unparsed: [text], not_configured: true, error: 'AI not connected: use typed Hinglish parsing on the phone' }, 200);

  const { data: products } = await client.from('products').select('id, name, name_hi, aliases, unit, is_loose').eq('is_active', true).limit(800);
  const catalogue = (products ?? []).map((p) => ({ id: p.id, name: p.name, name_hi: p.name_hi, aliases: p.aliases, unit: p.unit, loose: p.is_loose }));
  const out = await provider.chat({ system: SYSTEM, messages: [{ role: 'user', content: `ORDER: ${text}\nCATALOGUE: ${JSON.stringify(catalogue)}` }], schema: SCHEMA, maxTokens: 2000 });
  const parsed = (out.json ?? { items: [], unparsed: [text] }) as { items: unknown[]; unparsed: string[] };
  return json({ transcript: transcript ?? text, ...parsed, provider: provider.name, model: provider.model });
}));
