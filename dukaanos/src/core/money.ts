/**
 * Money is always an integer number of PAISE. ₹1 = 100 paise.
 * Never use floating point for rupee amounts anywhere in the app.
 */
export type Paise = number;

export function assertPaise(n: unknown, label = 'amount'): asserts n is Paise {
  if (typeof n !== 'number' || !Number.isInteger(n) || !Number.isFinite(n)) {
    throw new Error(`${label} must be an integer number of paise, got ${String(n)}`);
  }
}

/** Parse user input like "120", "120.5", "₹1,250.75", "1250/-" → paise. Returns null for invalid. */
export function parseRupees(input: string | number | null | undefined): Paise | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/\/-?$/, '').replace(/rs\.?/i, '');
  if (cleaned === '' || cleaned === '.' || cleaned === '-') return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const neg = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const paise = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -paise : paise;
}

/** Indian digit grouping: 1234567 → "12,34,567" */
export function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  let rest = whole.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return parts.join(',') + ',' + last3;
}

/** 123456 paise → "₹1,234.56"; 120000 → "₹1,200" (drops .00 unless `alwaysPaise`). */
export function formatPaise(paise: Paise, opts: { alwaysPaise?: boolean; sign?: boolean; symbol?: boolean } = {}): string {
  const { alwaysPaise = false, sign = false, symbol = true } = opts;
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let s = groupIndian(String(whole));
  if (frac !== 0 || alwaysPaise) s += '.' + String(frac).padStart(2, '0');
  const prefix = (neg ? '-' : sign ? '+' : '') + (symbol ? '₹' : '');
  return prefix + s;
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupeesNumber(paise: Paise): number {
  return paise / 100;
}

/** Multiply a unit price (paise) by a decimal quantity string, rounding half-up to the nearest paisa. */
export function mulPaiseByQty(unitPricePaise: Paise, qty: string | number): Paise {
  assertPaise(unitPricePaise, 'unit price');
  // Do exact arithmetic on scaled integers to avoid float error: qty has at most 3 decimals.
  const q = typeof qty === 'number' ? qty.toFixed(3) : qty;
  const m = /^(-?)(\d*)(?:\.(\d{0,3}))?$/.exec(q.trim());
  if (!m) throw new Error(`Invalid quantity ${qty}`);
  const neg = m[1] === '-';
  const whole = BigInt(m[2] || '0');
  const frac = BigInt((m[3] || '').padEnd(3, '0'));
  const scaled = whole * 1000n + frac; // qty * 1000
  const product = BigInt(unitPricePaise) * scaled; // paise * 1000
  // round half up
  const rounded = (product + 500n) / 1000n;
  const result = Number(rounded);
  return neg ? -result : result;
}

export function sumPaise(values: Paise[]): Paise {
  return values.reduce((a, b) => {
    assertPaise(b);
    return a + b;
  }, 0);
}

/** Percentage of an amount, rounded half-up. pct may have decimals. */
export function percentOf(paise: Paise, pct: number): Paise {
  assertPaise(paise);
  return Math.round((paise * pct) / 100 + Number.EPSILON);
}
