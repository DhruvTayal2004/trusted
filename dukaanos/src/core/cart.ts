import { mulPaiseByQty, sumPaise, type Paise } from './money';
import type { Unit } from './units';

export interface CartLine {
  id: string;
  productId: string | null;
  description: string;
  unit: Unit;
  qty: string; // decimal string, ≤3 dp
  unitPricePaise: Paise;
}

export interface CartPaymentPart {
  id: string;
  method: 'cash' | 'upi' | 'credit';
  amountPaise: Paise;
  upiReference?: string;
}

export interface CartTotals {
  subtotalPaise: Paise;
  discountPaise: Paise;
  totalPaise: Paise;
  lines: { id: string; lineTotalPaise: Paise }[];
}

export function lineTotal(line: Pick<CartLine, 'qty' | 'unitPricePaise'>): Paise {
  return mulPaiseByQty(line.unitPricePaise, line.qty);
}

export function computeTotals(lines: CartLine[], discountPaise: Paise = 0): CartTotals {
  const lineTotals = lines.map((l) => ({ id: l.id, lineTotalPaise: lineTotal(l) }));
  const subtotalPaise = sumPaise(lineTotals.map((l) => l.lineTotalPaise));
  if (discountPaise < 0) throw new Error('Discount cannot be negative');
  if (discountPaise > subtotalPaise) throw new Error('Discount cannot exceed subtotal');
  return { subtotalPaise, discountPaise, totalPaise: subtotalPaise - discountPaise, lines: lineTotals };
}

export interface PaymentSplitResult {
  ok: boolean;
  paidPaise: Paise;
  remainingPaise: Paise; // positive when under-paid, negative when over-paid
  error?: string;
}

export function validatePaymentSplit(totalPaise: Paise, parts: CartPaymentPart[], customerId: string | null): PaymentSplitResult {
  const paidPaise = sumPaise(parts.map((p) => p.amountPaise));
  const remainingPaise = totalPaise - paidPaise;
  if (parts.some((p) => p.amountPaise <= 0)) return { ok: false, paidPaise, remainingPaise, error: 'Each payment must be more than ₹0' };
  if (parts.some((p) => p.method === 'credit') && !customerId) return { ok: false, paidPaise, remainingPaise, error: 'Udhaar needs a customer' };
  if (remainingPaise !== 0) return { ok: false, paidPaise, remainingPaise, error: remainingPaise > 0 ? 'Payment is short' : 'Payment exceeds total' };
  return { ok: true, paidPaise, remainingPaise };
}

/**
 * Build the exact payload accepted by the `post_sale` RPC. Keeping this in one place means the
 * server-side validation (subtotal == Σ lines, total == subtotal − discount, Σ payments == total)
 * can never drift from what the client sends.
 */
export function buildSalePayload(args: {
  id: string;
  lines: CartLine[];
  discountPaise: Paise;
  discountReason?: string;
  payments: CartPaymentPart[];
  customerId: string | null;
  note?: string;
  source: 'manual' | 'voice' | 'barcode' | 'quick';
  clientCreatedAt: string; // ISO
  opId?: string;
}) {
  const totals = computeTotals(args.lines, args.discountPaise);
  const split = validatePaymentSplit(totals.totalPaise, args.payments, args.customerId);
  if (!split.ok) throw new Error(split.error);
  return {
    id: args.id,
    op_id: args.opId,
    client_created_at: args.clientCreatedAt,
    customer_id: args.customerId,
    source: args.source,
    note: args.note ?? null,
    discount_reason: args.discountReason ?? null,
    subtotal_paise: totals.subtotalPaise,
    discount_paise: totals.discountPaise,
    total_paise: totals.totalPaise,
    items: args.lines.map((l, i) => ({
      id: l.id,
      product_id: l.productId,
      description: l.description,
      unit: l.unit,
      qty: l.qty,
      unit_price_paise: l.unitPricePaise,
      line_total_paise: totals.lines[i].lineTotalPaise,
    })),
    payments: args.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount_paise: p.amountPaise,
      upi_reference: p.upiReference ?? null,
    })),
  };
}

export type SalePayload = ReturnType<typeof buildSalePayload>;
