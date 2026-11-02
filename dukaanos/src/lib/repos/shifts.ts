import { aggregateShift, expectedCash, reconcile } from '@/core/cash';
import { getDb } from '@/lib/db';
import { newId, nowIso } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import type { Shift } from './types';

export async function currentShift(memberId: string): Promise<Shift | null> {
  const db = await getDb();
  return db.getFirstAsync<Shift>(`select * from shifts where member_id = ? and status = 'open' order by opened_at desc limit 1`, memberId);
}

export async function openShift(args: { shopId: string; memberId: string; openingCashPaise: number }): Promise<Shift> {
  const existing = await currentShift(args.memberId);
  if (existing) return existing;
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  await db.runAsync('insert into shifts(id, shop_id, member_id, status, opened_at, opening_cash_paise, updated_at) values (?,?,?,?,?,?,?)', id, args.shopId, args.memberId, 'open', at, args.openingCashPaise, at);
  await enqueue('open_shift', { p_id: id, p_opening_cash_paise: args.openingCashPaise, p_client_created_at: at }, 'shifts', id);
  return (await db.getFirstAsync<Shift>('select * from shifts where id = ?', id))!;
}

export interface LocalShiftSummary {
  opening: number; cashSales: number; cashReceived: number; cashRefunds: number; cashExpenses: number; cashPaidOut: number; expected: number;
  upiSales: number; upiReceived: number; creditSales: number; salesCount: number; salesTotal: number;
}

/** Same formula as `shift_cash_summary()`, computed from the local mirror (works offline). */
export async function localShiftSummary(shift: Shift): Promise<LocalShiftSummary> {
  const db = await getDb();
  const payments = await db.getAllAsync<{ method: 'cash' | 'upi' | 'credit'; amount_paise: number; sale_id: string | null; status: string }>('select method, amount_paise, sale_id, status from payments where shift_id = ?', shift.id);
  const refunds = await db.getAllAsync<{ method: 'cash' | 'upi' | 'credit'; amount_paise: number }>('select method, amount_paise from refunds where shift_id = ?', shift.id);
  const expenses = await db.getAllAsync<{ paid_method: 'cash' | 'upi' | 'credit'; amount_paise: number; status: string }>('select paid_method, amount_paise, status from expenses where shift_id = ?', shift.id);
  const paidOut = await db.getAllAsync<{ payment_method: 'cash' | 'upi'; amount_paise: number }>(`select payment_method, amount_paise from supplier_ledger_entries where shift_id = ? and entry_type = 'payment'`, shift.id);
  const salesAgg = await db.getFirstAsync<{ c: number; t: number | null }>(`select count(*) c, sum(total_paise) t from sales where shift_id = ? and status <> 'reversed'`, shift.id);
  const agg = aggregateShift({
    openingCashPaise: shift.opening_cash_paise,
    payments: payments.map((p) => ({ method: p.method, amountPaise: p.amount_paise, saleId: p.sale_id, status: p.status })),
    refunds: refunds.map((r) => ({ method: r.method, amountPaise: r.amount_paise })),
    expenses: expenses.map((e) => ({ paidMethod: e.paid_method, amountPaise: e.amount_paise, status: e.status })),
    paidOut: paidOut.map((p) => ({ method: p.payment_method, amountPaise: -p.amount_paise })),
  });
  return {
    opening: agg.openingCashPaise, cashSales: agg.cashSalesPaise, cashReceived: agg.cashReceivedPaise, cashRefunds: agg.cashRefundsPaise, cashExpenses: agg.cashExpensesPaise,
    cashPaidOut: agg.cashPaidOutPaise, expected: expectedCash(agg), upiSales: agg.upiSalesPaise, upiReceived: agg.upiReceivedPaise, creditSales: agg.creditSalesPaise,
    salesCount: salesAgg?.c ?? 0, salesTotal: salesAgg?.t ?? 0,
  };
}

export async function closeShift(args: { shift: Shift; countedCashPaise: number; notes?: string; handoverTo?: string | null }): Promise<Shift> {
  const db = await getDb();
  const summary = await localShiftSummary(args.shift);
  const r = reconcile(
    { openingCashPaise: summary.opening, cashSalesPaise: summary.cashSales, cashReceivedPaise: summary.cashReceived, cashRefundsPaise: summary.cashRefunds, cashExpensesPaise: summary.cashExpenses, cashPaidOutPaise: summary.cashPaidOut },
    args.countedCashPaise,
  );
  const at = nowIso();
  await db.runAsync('update shifts set status = ?, closed_at = ?, expected_cash_paise = ?, counted_cash_paise = ?, cash_difference_paise = ?, closing_notes = ?, updated_at = ? where id = ?',
    'closed', at, r.expectedPaise, r.countedPaise, r.differencePaise, args.notes ?? null, at, args.shift.id);
  await enqueue('close_shift', { p_shift_id: args.shift.id, p_counted_cash_paise: args.countedCashPaise, p_notes: args.notes ?? null, p_handover_to: args.handoverTo ?? null }, 'shifts', args.shift.id);
  return (await db.getFirstAsync<Shift>('select * from shifts where id = ?', args.shift.id))!;
}

export async function listShifts(opts: { memberId?: string; limit?: number } = {}): Promise<(Shift & { member_name: string | null })[]> {
  const db = await getDb();
  return db.getAllAsync(
    `select s.*, m.display_name as member_name from shifts s left join members m on m.id = s.member_id ${opts.memberId ? 'where s.member_id = ?' : ''} order by s.opened_at desc limit ?`,
    ...(opts.memberId ? [opts.memberId] : []), opts.limit ?? 50,
  );
}
