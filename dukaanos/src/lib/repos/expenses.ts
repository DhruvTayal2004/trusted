import { getDb } from '@/lib/db';
import { newId, nowIso, todayLocal } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import type { Expense, ExpenseCategory } from './types';

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; name: string; requires_approval: number }>('select id, name, requires_approval from expense_categories order by name');
  return rows.map((r) => ({ ...r, requires_approval: r.requires_approval === 1 }));
}

export async function createExpense(args: { shopId: string; memberId: string; shiftId: string | null; role: string; category: ExpenseCategory | null; categoryName?: string; amountPaise: number; paidMethod: 'cash' | 'upi'; note?: string; receiptPath?: string | null; expenseDate?: string }): Promise<Expense> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const status = args.role === 'employee' && args.category?.requires_approval ? 'pending_approval' : 'recorded';
  const e: Expense = {
    id, member_id: args.memberId, shift_id: args.shiftId, category_id: args.category?.id ?? null, category_name: args.category?.name ?? args.categoryName ?? 'Other',
    amount_paise: args.amountPaise, paid_method: args.paidMethod, expense_date: args.expenseDate ?? todayLocal(), note: args.note ?? null, receipt_image_path: args.receiptPath ?? null, status, client_created_at: at,
  };
  await db.runAsync('insert into expenses(id, shop_id, member_id, shift_id, category_id, category_name, amount_paise, paid_method, expense_date, note, receipt_image_path, status, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, args.shopId, e.member_id, e.shift_id, e.category_id, e.category_name, e.amount_paise, e.paid_method, e.expense_date, e.note, e.receipt_image_path, status, at, at);
  await enqueue('post_expense', { p: { id, category_id: e.category_id, category_name: e.category_name, amount_paise: e.amount_paise, paid_method: e.paid_method, expense_date: e.expense_date, note: e.note, receipt_image_path: e.receipt_image_path, client_created_at: at } }, 'expenses', id);
  return e;
}

export async function listExpenses(opts: { date?: string; shiftId?: string; status?: string; limit?: number } = {}): Promise<Expense[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.date) { where.push('expense_date = ?'); params.push(opts.date); }
  if (opts.shiftId) { where.push('shift_id = ?'); params.push(opts.shiftId); }
  if (opts.status) { where.push('status = ?'); params.push(opts.status); }
  return db.getAllAsync<Expense>(`select * from expenses ${where.length ? 'where ' + where.join(' and ') : ''} order by expense_date desc, client_created_at desc limit ?`, ...params, opts.limit ?? 200);
}

export async function decideExpenseLocal(expenseId: string, approve: boolean, note?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('update expenses set status = ?, updated_at = ? where id = ?', approve ? 'approved' : 'rejected', nowIso(), expenseId);
  await enqueue('decide_expense', { p_expense_id: expenseId, p_approve: approve, p_note: note ?? null }, 'expenses', expenseId);
}
