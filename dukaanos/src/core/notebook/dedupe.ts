/**
 * Duplicate detection for notebook imports: an extracted entry is a *possible* duplicate of an
 * existing ledger entry when party, amount and date (±1 day) coincide. Only a hint — the owner decides.
 */
export interface LedgerLike { party_id: string | null; amount_paise: number; entry_date: string }
export interface ExtractedLike { party_id: string | null; amount_paise: number | null; entry_date: string | null }

export function daysBetween(a: string, b: string): number {
  return Math.abs((Date.parse(a) - Date.parse(b)) / 86_400_000);
}

export function isPossibleDuplicate(e: ExtractedLike, existing: LedgerLike[], toleranceDays = 1): LedgerLike | null {
  if (e.amount_paise == null || !e.party_id) return null;
  for (const x of existing) {
    if (x.party_id !== e.party_id || Math.abs(x.amount_paise) !== Math.abs(e.amount_paise)) continue;
    if (!e.entry_date || daysBetween(e.entry_date, x.entry_date) <= toleranceDays) return x;
  }
  return null;
}

/** Normalise a handwritten name for fuzzy party matching: lowercase, strip honorifics/punctuation. */
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/\b(ji|bhai|sahab|saab|sir|madam|didi|bhaiya|uncle|aunty|shri|smt)\b/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Simple similarity (Dice coefficient on bigrams) — good enough to rank customer suggestions. */
export function similarity(a: string, b: string): number {
  const x = normaliseName(a), y = normaliseName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => { const g = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1); } return g; };
  const ga = grams(x), gb = grams(y);
  let inter = 0;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return (2 * inter) / ((x.length - 1) + (y.length - 1));
}

export function suggestParties<T extends { id: string; name: string }>(name: string, parties: T[], limit = 3): { party: T; score: number }[] {
  return parties.map((p) => ({ party: p, score: similarity(name, p.name) })).filter((s) => s.score >= 0.4).sort((a, b) => b.score - a.score).slice(0, limit);
}
