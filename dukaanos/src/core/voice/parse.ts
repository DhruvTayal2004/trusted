import { isLooseUnit, parseNumberWord, parseUnitWord, type Unit } from '@/core/units';

/**
 * Deterministic Hinglish order parser — the on-device fallback when the AI voice endpoint is
 * unreachable, and the first pass for typed orders. "do kilo chawal, ek kilo chini aur aadha kilo dal"
 * → [{qty:'2', unit:'kg', words:'chawal'}, ...]. Product matching is done separately (matchProduct).
 */
export interface ParsedFragment {
  raw: string;
  qty: string | null;
  unit: Unit | null;
  words: string; // leftover words = product name candidates
}

const SEPARATORS = /\s*(?:,|;|\baur\b|\bor\b|\band\b|\bplus\b|\bphir\b|\n)\s*/i;
const FILLER = new Set(['ka', 'ki', 'ke', 'de', 'do', 'dena', 'dijiye', 'chahiye', 'wala', 'wali', 'the', 'a', 'an', 'of', 'please', 'bhi', 'ek', 'one']);

export function splitOrder(text: string): string[] {
  return text.split(SEPARATORS).map((s) => s.trim()).filter(Boolean);
}

export function parseFragment(raw: string): ParsedFragment {
  const tokens = raw.toLowerCase().replace(/[^\p{L}\p{N}.,\s]/gu, ' ').split(/\s+/).filter(Boolean);
  let qty: string | null = null;
  let unit: Unit | null = null;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    // "2kg", "500g", "1.5kilo" glued forms
    const glued = /^(\d+(?:[.,]\d+)?)([a-z]+)$/.exec(t);
    if (glued && parseUnitWord(glued[2]) && qty === null) { qty = glued[1].replace(',', '.'); unit = parseUnitWord(glued[2]); continue; }
    const n = parseNumberWord(t);
    if (n !== null && qty === null) {
      // "do" is both "2" and the verb "give"; treat as number only when followed by a unit or product word
      if (t === 'do' && i === tokens.length - 1) { rest.push(t); continue; }
      qty = n;
      // compound: "dedh sau" (150), "do sau" (200)
      if (tokens[i + 1] === 'sau') { qty = String(Number(n) * 100); i++; }
      continue;
    }
    const u = parseUnitWord(t);
    if (u && unit === null) { unit = u; continue; }
    if (!FILLER.has(t) || (t === 'do' && rest.length)) rest.push(t);
  }
  // "ek" alone = 1 only when nothing else parsed as qty
  if (qty === null && /\bek\b/.test(raw.toLowerCase())) qty = '1';
  return { raw, qty, unit, words: rest.join(' ').trim() };
}

export function parseOrder(text: string): ParsedFragment[] {
  return splitOrder(text).map(parseFragment).filter((f) => f.words || f.qty);
}

export interface MatchableProduct { id: string; name: string; name_hi: string | null; aliases: string[]; unit: Unit; is_loose: boolean }

/** Score 0..1: exact alias/name hit = 1, prefix = 0.8, substring = 0.6, fuzzy token overlap otherwise. */
export function scoreMatch(words: string, p: MatchableProduct): number {
  const w = words.toLowerCase().trim();
  if (!w) return 0;
  const names = [p.name, p.name_hi ?? '', ...p.aliases].map((s) => s.toLowerCase()).filter(Boolean);
  if (names.some((n) => n === w)) return 1;
  if (names.some((n) => n.startsWith(w) || w.startsWith(n))) return 0.8;
  if (names.some((n) => n.includes(w) || w.includes(n))) return 0.6;
  const wt = new Set(w.split(/\s+/));
  let best = 0;
  for (const n of names) {
    const nt = n.split(/[\s()\-/]+/).filter(Boolean);
    const hit = nt.filter((t) => wt.has(t) || [...wt].some((x) => x.length > 3 && (t.startsWith(x) || x.startsWith(t)))).length;
    if (nt.length) best = Math.max(best, (hit / nt.length) * 0.5);
  }
  return best;
}

export interface MatchResult { fragment: ParsedFragment; product: MatchableProduct | null; candidates: MatchableProduct[]; qty: string | null; unit: Unit | null; needsClarification: string | null }

export function matchFragment(f: ParsedFragment, products: MatchableProduct[]): MatchResult {
  const scored = products.map((p) => ({ p, s: scoreMatch(f.words, p) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s);
  const top = scored[0];
  const ties = scored.filter((x) => top && x.s === top.s);
  const candidates = scored.slice(0, 4).map((x) => x.p);
  if (!top) return { fragment: f, product: null, candidates: [], qty: f.qty, unit: f.unit, needsClarification: `"${f.words || f.raw}" kaunsa product hai?` };
  if (ties.length > 1) return { fragment: f, product: null, candidates, qty: f.qty, unit: f.unit, needsClarification: `${f.words}: ${ties.map((t) => t.p.name).join(' ya ')}?` };
  const p = top.p;
  let qty = f.qty;
  let unit = f.unit ?? p.unit;
  if (!isLooseUnit(p.unit) && unit !== p.unit) unit = p.unit; // "2 packet biscuit" → pkt
  if (qty === null) {
    if (isLooseUnit(p.unit)) return { fragment: f, product: p, candidates, qty: null, unit, needsClarification: `${p.name} kitna? (kg/g)` };
    qty = '1';
  }
  return { fragment: f, product: p, candidates, qty, unit, needsClarification: null };
}

export function parseAndMatch(text: string, products: MatchableProduct[]): MatchResult[] {
  return parseOrder(text).map((f) => matchFragment(f, products));
}
