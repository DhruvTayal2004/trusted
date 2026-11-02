import { bool, fromBool, getDb } from '@/lib/db';
import { newId, nowIso, todayLocal } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import type { Customer, LedgerEntry, Payment } from './types';

type Raw = Omit<Customer, 'is_active'> & { is_active: number };
const hydrate = (r: Raw): Customer => ({ ...r, is_active: fromBool(r.is_active) });

export async function listCustomers(search = '', opts: { withBalanceOnly?: boolean } = {}): Promise<Customer[]> {
  const db = await getDb();
  const s = `%${search.trim().toLowerCase()}%`;
  const rows = await db.getAllAsync<Raw>(
    `select * from customers where is_active = 1 ${search.trim() ? 'and (lower(name) like ? or coalesce(phone, \'\') like ?)' : ''} ${opts.withBalanceOnly ? 'and balance_paise <> 0' : ''} order by name limit 500`,
    ...(search.trim() ? [s, s] : []),
  );
  return rows.map(hydrate);
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Raw>('select * from customers where id = ?', id);
  return r ? hydrate(r) : null;
}

export async function saveCustomer(shopId: string, input: { id?: string; name: string; phone?: string | null; address?: string | null; notes?: string | null; credit_limit_paise?: number | null }): Promise<Customer> {
  const db = await getDb();
  const id = input.id ?? newId();
  const existing = input.id ? await getCustomer(input.id) : null;
  const updated_at = nowIso();
  const c: Customer = {
    id, shop_id: shopId, name: input.name.trim(), phone: input.phone?.trim() || null, address: input.address ?? null, notes: input.notes ?? null,
    balance_paise: existing?.balance_paise ?? 0, credit_limit_paise: input.credit_limit_paise ?? null, is_active: true, updated_at,
  };
  await db.runAsync(
    'insert or replace into customers(id, shop_id, name, phone, address, notes, balance_paise, credit_limit_paise, is_active, updated_at, dirty) values (?,?,?,?,?,?,?,?,?,?,1)',
    id, shopId, c.name, c.phone, c.address, c.notes, c.balance_paise, c.credit_limit_paise, bool(true), updated_at,
  );
  await enqueue('upsert:customers', { id, shop_id: shopId, name: c.name, phone: c.phone, address: c.address, notes: c.notes, credit_limit_paise: c.credit_limit_paise, is_active: true }, 'customers', id);
  return c;
}

export async function bumpLocalBalance(customerId: string, deltaPaise: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('update customers set balance_paise = balance_paise + ? where id = ?', deltaPaise, customerId);
}

export async function customerLedger(customerId: string, limit = 100): Promise<LedgerEntry[]> {
  const db = await getDb();
  return db.getAllAsync<LedgerEntry>('select * from customer_ledger_entries where customer_id = ? order by entry_date desc, client_created_at desc limit ?', customerId, limit);
}

/** Record cash/UPI received against khata. Local projection + post_khata_payment RPC. */
export async function recordKhataPayment(args: { shopId: string; memberId: string; shiftId: string | null; customerId: string; method: 'cash' | 'upi'; amountPaise: number; upiReference?: string; note?: string }): Promise<Payment> {
  const db = await getDb();
  const id = newId();
  const opId = newId();
  const at = nowIso();
  const payment: Payment = {
    id, shop_id: args.shopId, sale_id: null, customer_id: args.customerId, member_id: args.memberId, shift_id: args.shiftId, method: args.method,
    status: args.method === 'upi' ? 'pending_verification' : 'received', amount_paise: args.amountPaise, upi_reference: args.upiReference ?? null, note: args.note ?? null, client_created_at: at,
  };
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'insert into payments(id, shop_id, sale_id, customer_id, member_id, shift_id, method, status, amount_paise, upi_reference, note, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, null, args.customerId, args.memberId, args.shiftId, args.method, payment.status, args.amountPaise, payment.upi_reference, payment.note, at, at,
    );
    await db.runAsync(
      'insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, sale_id, payment_id, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
      newId(), args.shopId, args.customerId, args.memberId, 'payment', -args.amountPaise, null, id, todayLocal(), payment.note, at,
    );
    await db.runAsync('update customers set balance_paise = balance_paise - ? where id = ?', args.amountPaise, args.customerId);
  });
  await enqueue('post_khata_payment', { p: { id, op_id: opId, customer_id: args.customerId, method: args.method, amount_paise: args.amountPaise, upi_reference: args.upiReference ?? null, note: args.note ?? null, client_created_at: at, entry_date: todayLocal() } }, 'payments', id, opId);
  return payment;
}

/** Opening balance / adjustment (managers) or plain udhaar without a sale (any member). */
export async function recordKhataEntry(args: { shopId: string; memberId: string; customerId: string; entryType: 'opening_balance' | 'adjustment' | 'credit_sale'; amountPaise: number; note?: string; entryDate?: string }): Promise<LedgerEntry> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const entry: LedgerEntry = { id, customer_id: args.customerId, entry_type: args.entryType, amount_paise: args.amountPaise, sale_id: null, payment_id: null, entry_date: args.entryDate ?? todayLocal(), note: args.note ?? null, client_created_at: at };
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, sale_id, payment_id, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, args.customerId, args.memberId, args.entryType, args.amountPaise, null, null, entry.entry_date, entry.note, at,
    );
    await db.runAsync('update customers set balance_paise = balance_paise + ? where id = ?', args.amountPaise, args.customerId);
  });
  await enqueue('post_khata_entry', { p: { id, customer_id: args.customerId, entry_type: args.entryType, amount_paise: args.amountPaise, note: args.note ?? null, entry_date: entry.entry_date, client_created_at: at } }, 'customer_ledger_entries', id);
  return entry;
}

export async function totalOutstanding(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ s: number | null }>('select sum(balance_paise) s from customers where balance_paise > 0');
  return r?.s ?? 0;
}
