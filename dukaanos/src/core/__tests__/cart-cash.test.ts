import { describe, expect, it } from 'vitest';
import { buildSalePayload, computeTotals, validatePaymentSplit, type CartLine } from '../cart';
import { aggregateShift, expectedCash, reconcile } from '../cash';
import { canApplyDiscount, visibleActions } from '../permissions';
import { convertQty, normaliseQty, parseNumberWord, parseUnitWord } from '../units';

const rice: CartLine = { id: 'l1', productId: 'p1', description: 'Rice', unit: 'kg', qty: '2', unitPricePaise: 8000 };
const biscuit: CartLine = { id: 'l2', productId: 'p3', description: 'Parle-G', unit: 'pkt', qty: '1', unitPricePaise: 1000 };

describe('cart', () => {
  it('computes totals with discount', () => {
    const t = computeTotals([rice, biscuit], 500);
    expect(t.subtotalPaise).toBe(17000);
    expect(t.totalPaise).toBe(16500);
    expect(t.lines[0].lineTotalPaise).toBe(16000);
    expect(() => computeTotals([rice], 20000)).toThrow();
  });

  it('validates mixed payments', () => {
    expect(validatePaymentSplit(17000, [{ id: 'a', method: 'cash', amountPaise: 10000 }, { id: 'b', method: 'upi', amountPaise: 7000 }], null).ok).toBe(true);
    const short = validatePaymentSplit(17000, [{ id: 'a', method: 'cash', amountPaise: 10000 }], null);
    expect(short.ok).toBe(false);
    expect(short.remainingPaise).toBe(7000);
    expect(validatePaymentSplit(100, [{ id: 'a', method: 'credit', amountPaise: 100 }], null).error).toMatch(/customer/);
    expect(validatePaymentSplit(100, [{ id: 'a', method: 'credit', amountPaise: 100 }], 'c1').ok).toBe(true);
  });

  it('builds a server-consistent payload', () => {
    const p = buildSalePayload({
      id: 's1', lines: [rice, biscuit], discountPaise: 0, payments: [{ id: 'pay1', method: 'cash', amountPaise: 17000 }],
      customerId: null, source: 'manual', clientCreatedAt: '2026-11-02T10:00:00Z',
    });
    expect(p.subtotal_paise).toBe(p.items.reduce((a, i) => a + i.line_total_paise, 0));
    expect(p.total_paise).toBe(p.subtotal_paise - p.discount_paise);
    expect(p.payments.reduce((a, x) => a + x.amount_paise, 0)).toBe(p.total_paise);
  });
});

describe('cash reconciliation', () => {
  const inputs = { openingCashPaise: 100000, cashSalesPaise: 10000, cashReceivedPaise: 20000, cashRefundsPaise: 0, cashExpensesPaise: 3000, cashPaidOutPaise: 50000 };
  it('matches the SQL formula', () => {
    expect(expectedCash(inputs)).toBe(77000);
    const r = reconcile(inputs, 75000);
    expect(r.differencePaise).toBe(-2000);
    expect(r.status).toBe('short');
    expect(reconcile(inputs, 77000).status).toBe('balanced');
  });
  it('aggregates raw records and keeps UPI/credit out of cash', () => {
    const agg = aggregateShift({
      openingCashPaise: 100000,
      payments: [
        { method: 'cash', amountPaise: 10000, saleId: 's1' },
        { method: 'upi', amountPaise: 7000, saleId: 's1' },
        { method: 'credit', amountPaise: 9000, saleId: 's2' },
        { method: 'cash', amountPaise: 20000, saleId: null },
        { method: 'cash', amountPaise: 999, saleId: 's9', status: 'failed' },
      ],
      refunds: [], expenses: [{ paidMethod: 'cash', amountPaise: 3000 }, { paidMethod: 'cash', amountPaise: 100, status: 'rejected' }], paidOut: [{ method: 'cash', amountPaise: 50000 }],
    });
    expect(expectedCash(agg)).toBe(77000);
    expect(agg.upiSalesPaise).toBe(7000);
    expect(agg.creditSalesPaise).toBe(9000);
  });
});

describe('permissions', () => {
  it('limits employee discounts', () => {
    const emp = { role: 'employee' as const, permissions: { can_discount: true, max_discount_pct: 5 } };
    expect(canApplyDiscount(emp, 10000, 500).ok).toBe(true);
    expect(canApplyDiscount(emp, 10000, 501).ok).toBe(false);
    expect(canApplyDiscount({ role: 'employee', permissions: null }, 10000, 1).ok).toBe(false);
    expect(canApplyDiscount({ role: 'owner', permissions: null }, 10000, 9999).ok).toBe(true);
  });
  it('gates screens by role', () => {
    expect(visibleActions({ role: 'employee', permissions: null }).dashboard).toBe(false);
    expect(visibleActions({ role: 'employee', permissions: { can_receive_stock: true } }).receiveStock).toBe(true);
    expect(visibleActions({ role: 'admin', permissions: null }).scanner).toBe(true);
  });
});

describe('units', () => {
  it('converts within a family only', () => {
    expect(convertQty('1.5', 'kg', 'g').toString()).toBe('1500');
    expect(convertQty('250', 'g', 'kg').toString()).toBe('0.25');
    expect(() => convertQty(1, 'kg', 'l')).toThrow();
  });
  it('normalises quantities', () => {
    expect(normaliseQty('1,5', 'kg')).toBe('1.5');
    expect(normaliseQty('1.5', 'pkt')).toBeNull();
    expect(normaliseQty('0', 'kg')).toBeNull();
    expect(normaliseQty('2.0005', 'kg')).toBe('2.001');
  });
  it('parses Hinglish numbers and units', () => {
    expect(parseNumberWord('aadha')).toBe('0.5');
    expect(parseNumberWord('dedh')).toBe('1.5');
    expect(parseNumberWord('do')).toBe('2');
    expect(parseNumberWord('2.5')).toBe('2.5');
    expect(parseUnitWord('kilo')).toBe('kg');
    expect(parseUnitWord('packet')).toBe('pkt');
    expect(parseUnitWord('xyz')).toBeNull();
  });
});
