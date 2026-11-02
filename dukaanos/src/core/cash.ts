import { type Paise } from './money';

/**
 * Deterministic cash reconciliation, mirroring `shift_cash_summary()` in Postgres.
 * The app uses this to show a live "expected cash" while offline; the server recomputes at close.
 *
 * Expected cash = opening + cash sales + cash received (khata) − cash refunds − cash expenses − cash paid out.
 * UPI and credit never touch expected cash.
 */
export interface ShiftCashInputs {
  openingCashPaise: Paise;
  cashSalesPaise: Paise;
  cashReceivedPaise: Paise; // khata collections in cash
  cashRefundsPaise: Paise;
  cashExpensesPaise: Paise;
  cashPaidOutPaise: Paise; // supplier payments in cash etc.
}

export function expectedCash(i: ShiftCashInputs): Paise {
  return i.openingCashPaise + i.cashSalesPaise + i.cashReceivedPaise - i.cashRefundsPaise - i.cashExpensesPaise - i.cashPaidOutPaise;
}

export interface Reconciliation {
  expectedPaise: Paise;
  countedPaise: Paise;
  differencePaise: Paise; // counted − expected: negative = short, positive = excess
  status: 'balanced' | 'short' | 'excess';
}

export function reconcile(inputs: ShiftCashInputs, countedPaise: Paise): Reconciliation {
  const expectedPaise = expectedCash(inputs);
  const differencePaise = countedPaise - expectedPaise;
  return {
    expectedPaise,
    countedPaise,
    differencePaise,
    status: differencePaise === 0 ? 'balanced' : differencePaise < 0 ? 'short' : 'excess',
  };
}

export type PaymentLike = { method: 'cash' | 'upi' | 'credit'; amountPaise: Paise; saleId: string | null; status?: string };
export type RefundLike = { method: 'cash' | 'upi' | 'credit'; amountPaise: Paise };
export type ExpenseLike = { paidMethod: 'cash' | 'upi' | 'credit'; amountPaise: Paise; status?: string };
export type PaidOutLike = { method: 'cash' | 'upi'; amountPaise: Paise };

/** Aggregate raw local records for a shift into ShiftCashInputs. */
export function aggregateShift(args: {
  openingCashPaise: Paise;
  payments: PaymentLike[];
  refunds: RefundLike[];
  expenses: ExpenseLike[];
  paidOut: PaidOutLike[];
}): ShiftCashInputs & { upiSalesPaise: Paise; upiReceivedPaise: Paise; creditSalesPaise: Paise } {
  const live = args.payments.filter((p) => p.status !== 'failed');
  const sum = (xs: { amountPaise: Paise }[]) => xs.reduce((a, b) => a + b.amountPaise, 0);
  return {
    openingCashPaise: args.openingCashPaise,
    cashSalesPaise: sum(live.filter((p) => p.method === 'cash' && p.saleId)),
    cashReceivedPaise: sum(live.filter((p) => p.method === 'cash' && !p.saleId)),
    cashRefundsPaise: sum(args.refunds.filter((r) => r.method === 'cash')),
    cashExpensesPaise: sum(args.expenses.filter((e) => e.paidMethod === 'cash' && e.status !== 'rejected')),
    cashPaidOutPaise: sum(args.paidOut.filter((p) => p.method === 'cash')),
    upiSalesPaise: sum(live.filter((p) => p.method === 'upi' && p.saleId)),
    upiReceivedPaise: sum(live.filter((p) => p.method === 'upi' && !p.saleId)),
    creditSalesPaise: sum(live.filter((p) => p.method === 'credit')),
  };
}
