import Decimal from 'decimal.js';

export type Unit = 'kg' | 'g' | 'l' | 'ml' | 'pc' | 'pkt' | 'bag';

export const UNITS: Unit[] = ['kg', 'g', 'l', 'ml', 'pc', 'pkt', 'bag'];

export const UNIT_LABELS: Record<Unit, { en: string; hi: string; short: string }> = {
  kg: { en: 'Kilogram', hi: 'किलो', short: 'kg' },
  g: { en: 'Gram', hi: 'ग्राम', short: 'g' },
  l: { en: 'Litre', hi: 'लीटर', short: 'L' },
  ml: { en: 'Millilitre', hi: 'मिली', short: 'ml' },
  pc: { en: 'Piece', hi: 'पीस', short: 'pc' },
  pkt: { en: 'Packet', hi: 'पैकेट', short: 'pkt' },
  bag: { en: 'Bag', hi: 'बोरी', short: 'bag' },
};

/** Units that are sold loose (by weight/volume) and allow fractional quantities. */
export const LOOSE_UNITS: Unit[] = ['kg', 'g', 'l', 'ml'];

export function isLooseUnit(u: Unit): boolean {
  return LOOSE_UNITS.includes(u);
}

const FAMILY: Record<Unit, { base: Unit; factor: string }> = {
  kg: { base: 'g', factor: '1000' },
  g: { base: 'g', factor: '1' },
  l: { base: 'ml', factor: '1000' },
  ml: { base: 'ml', factor: '1' },
  pc: { base: 'pc', factor: '1' },
  pkt: { base: 'pkt', factor: '1' },
  bag: { base: 'bag', factor: '1' },
};

export function canConvert(from: Unit, to: Unit): boolean {
  return FAMILY[from].base === FAMILY[to].base;
}

/** Convert a quantity between compatible units. Returns a Decimal; throws on incompatible units. */
export function convertQty(qty: Decimal.Value, from: Unit, to: Unit): Decimal {
  if (!canConvert(from, to)) throw new Error(`Cannot convert ${from} to ${to}`);
  const inBase = new Decimal(qty).mul(FAMILY[from].factor);
  return inBase.div(FAMILY[to].factor);
}

/** Normalise a user-entered quantity to a string with at most 3 decimals, or null if invalid/non-positive. */
export function normaliseQty(input: string | number, unit: Unit): string | null {
  let d: Decimal;
  try {
    d = new Decimal(typeof input === 'string' ? input.trim().replace(',', '.') : input);
  } catch {
    return null;
  }
  if (!d.isFinite() || d.lte(0)) return null;
  if (!isLooseUnit(unit) && !d.isInteger()) return null; // can't sell 1.5 packets
  return d.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toString();
}

/** "1.5" kg → "1.5 kg", "250" g → "250 g", "2" pc → "2 pc" */
export function formatQty(qty: string | number, unit: Unit): string {
  const d = new Decimal(qty);
  return `${d.toDecimalPlaces(3).toString()} ${UNIT_LABELS[unit].short}`;
}

/**
 * Hinglish quantity words → decimal. "aadha" = 0.5, "paav" = 0.25, "dedh" = 1.5, "dhai" = 2.5, "sawa" = 1.25, "pauna" = 0.75.
 * Also parses "250 gram", "1.5 kilo", "2 kg", "ek", "do", "teen"...
 */
const NUMBER_WORDS: Record<string, string> = {
  ek: '1', do: '2', teen: '3', tin: '3', char: '4', chaar: '4', paanch: '5', panch: '5', pach: '5', chhe: '6', che: '6', saat: '7', sat: '7',
  aath: '8', ath: '8', nau: '9', das: '10', dus: '10', gyarah: '11', barah: '12', bees: '20', pachas: '50', sau: '100',
  aadha: '0.5', adha: '0.5', half: '0.5', paav: '0.25', pao: '0.25', pav: '0.25', quarter: '0.25', dedh: '1.5', dedha: '1.5', dhai: '2.5', dhayi: '2.5',
  sawa: '1.25', sava: '1.25', pauna: '0.75', paune: '0.75', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};

const UNIT_WORDS: Record<string, Unit> = {
  kg: 'kg', kilo: 'kg', kilogram: 'kg', kilos: 'kg', किलो: 'kg',
  g: 'g', gm: 'g', gram: 'g', grams: 'g', ग्राम: 'g',
  l: 'l', litre: 'l', liter: 'l', ltr: 'l', लीटर: 'l',
  ml: 'ml', मिली: 'ml',
  pc: 'pc', piece: 'pc', pieces: 'pc', pcs: 'pc', nag: 'pc', पीस: 'pc',
  pkt: 'pkt', packet: 'pkt', packets: 'pkt', pack: 'pkt', पैकेट: 'pkt',
  bag: 'bag', bags: 'bag', bori: 'bag', बोरी: 'bag', katta: 'bag',
};

export function parseNumberWord(token: string): string | null {
  const t = token.toLowerCase();
  if (/^\d+([.,]\d+)?$/.test(t)) return t.replace(',', '.');
  return NUMBER_WORDS[t] ?? null;
}

export function parseUnitWord(token: string): Unit | null {
  return UNIT_WORDS[token.toLowerCase()] ?? null;
}
