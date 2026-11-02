import { getDb } from '@/lib/db';
import { todayLocal } from '@/lib/ids';
import { supabase } from '@/lib/supabase';

export interface DailySummary {
  date: string;
  sales_count: number; sales_total_paise: number; cash_sales_paise: number; upi_sales_paise: number; upi_pending_paise: number; credit_sales_paise: number;
  khata_collected_paise: number; refunds_paise: number; expenses_paise: number; expenses_pending_count: number; supplier_paid_paise: number; purchases_paise: number;
  outstanding_customer_paise: number; outstanding_supplier_paise: number; low_stock_count: number;
  open_shifts: { shift_id: string; member: string; opened_at: string }[];
  closed_shifts: { shift_id: string; member: string; expected_paise: number; counted_paise: number; difference_paise: number }[];
  pending_approvals: number;
  by_employee: { member: string; sales_count: number; sales_paise: number }[];
  source: 'server' | 'local';
}

/** Owner dashboard numbers. Prefers the deterministic server function; falls back to the local mirror offline. */
export async function dailySummary(date: string = todayLocal()): Promise<DailySummary> {
  try {
    const { data, error } = await supabase.rpc('daily_summary', { p_date: date });
    if (error) throw error;
    return { ...(data as DailySummary), source: 'server' };
  } catch {
    return localDailySummary(date);
  }
}

export async function localDailySummary(date: string = todayLocal()): Promise<DailySummary> {
  const db = await getDb();
  const one = async <T,>(sql: string, ...p: (string | number)[]) => (await db.getFirstAsync<T>(sql, ...p))!;
  const s = await one<{ c: number; t: number | null }>(`select count(*) c, sum(total_paise) t from sales where substr(client_created_at,1,10) = ? and status <> 'reversed'`, date);
  const pay = async (where: string) => (await one<{ t: number | null }>(`select sum(amount_paise) t from payments where substr(client_created_at,1,10) = ? and status <> 'failed' and ${where}`, date)).t ?? 0;
  const exp = await one<{ t: number | null }>(`select sum(amount_paise) t from expenses where expense_date = ? and status <> 'rejected'`, date);
  const expPending = await one<{ c: number }>(`select count(*) c from expenses where status = 'pending_approval'`);
  const refunds = await one<{ t: number | null }>(`select sum(amount_paise) t from refunds where substr(client_created_at,1,10) = ?`, date);
  const supPaid = await one<{ t: number | null }>(`select sum(-amount_paise) t from supplier_ledger_entries where entry_type = 'payment' and entry_date = ?`, date);
  const purchases = await one<{ t: number | null }>(`select sum(total_paise) t from purchases where invoice_date = ?`, date);
  const outC = await one<{ t: number | null }>('select sum(balance_paise) t from customers where balance_paise > 0');
  const outS = await one<{ t: number | null }>('select sum(balance_paise) t from suppliers where balance_paise > 0');
  const low = await one<{ c: number }>(`select count(*) c from products where is_active = 1 and cast(min_stock_qty as real) > 0 and cast(stock_qty as real) <= cast(min_stock_qty as real)`);
  const open = await db.getAllAsync<{ shift_id: string; member: string; opened_at: string }>(`select s.id shift_id, coalesce(m.display_name, '?') member, s.opened_at from shifts s left join members m on m.id = s.member_id where s.status = 'open'`);
  const closed = await db.getAllAsync<{ shift_id: string; member: string; expected_paise: number; counted_paise: number; difference_paise: number }>(
    `select s.id shift_id, coalesce(m.display_name, '?') member, s.expected_cash_paise expected_paise, s.counted_cash_paise counted_paise, s.cash_difference_paise difference_paise from shifts s left join members m on m.id = s.member_id where s.status = 'closed' and substr(s.closed_at,1,10) = ? order by s.closed_at`, date);
  const byEmp = await db.getAllAsync<{ member: string; sales_count: number; sales_paise: number }>(
    `select coalesce(m.display_name, '?') member, count(*) sales_count, sum(s.total_paise) sales_paise from sales s left join members m on m.id = s.member_id where substr(s.client_created_at,1,10) = ? and s.status <> 'reversed' group by s.member_id`, date);
  return {
    date, sales_count: s.c, sales_total_paise: s.t ?? 0,
    cash_sales_paise: await pay(`method = 'cash' and sale_id is not null`), upi_sales_paise: await pay(`method = 'upi' and sale_id is not null`),
    upi_pending_paise: await pay(`method = 'upi' and status = 'pending_verification'`), credit_sales_paise: await pay(`method = 'credit'`),
    khata_collected_paise: await pay('sale_id is null'), refunds_paise: refunds.t ?? 0, expenses_paise: exp.t ?? 0, expenses_pending_count: expPending.c,
    supplier_paid_paise: supPaid.t ?? 0, purchases_paise: purchases.t ?? 0, outstanding_customer_paise: outC.t ?? 0, outstanding_supplier_paise: outS.t ?? 0, low_stock_count: low.c,
    open_shifts: open, closed_shifts: closed, pending_approvals: 0, by_employee: byEmp, source: 'local',
  };
}
