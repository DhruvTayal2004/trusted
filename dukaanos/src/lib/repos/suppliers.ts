import { bool, fromBool, getDb } from '@/lib/db';
import { newId, nowIso, todayLocal } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import type { Supplier, SupplierLedgerEntry } from './types';

type Raw = Omit<Supplier, 'is_active'> & { is_active: number };
const hydrate = (r: Raw): Supplier => ({ ...r, is_active: fromBool(r.is_active) });

export async function listSuppliers(search = ''): Promise<Supplier[]> {
  const db = await getDb();
  const s = `%${search.trim().toLowerCase()}%`;
  const rows = await db.getAllAsync<Raw>(`select * from suppliers where is_active = 1 ${search.trim() ? 'and lower(name) like ?' : ''} order by name`, ...(search.trim() ? [s] : []));
  return rows.map(hydrate);
}

export async function getSupplier(id: string): Promise<Supplier | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Raw>('select * from suppliers where id = ?', id);
  return r ? hydrate(r) : null;
}

export async function saveSupplier(shopId: string, input: { id?: string; name: string; phone?: string | null; address?: string | null; gstin?: string | null; notes?: string | null }): Promise<Supplier> {
  const db = await getDb();
  const id = input.id ?? newId();
  const existing = input.id ? await getSupplier(input.id) : null;
  const updated_at = nowIso();
  const s: Supplier = { id, shop_id: shopId, name: input.name.trim(), phone: input.phone?.trim() || null, address: input.address ?? null, gstin: input.gstin ?? null, notes: input.notes ?? null, balance_paise: existing?.balance_paise ?? 0, is_active: true, updated_at };
  await db.runAsync('insert or replace into suppliers(id, shop_id, name, phone, address, gstin, notes, balance_paise, is_active, updated_at, dirty) values (?,?,?,?,?,?,?,?,?,?,1)', id, shopId, s.name, s.phone, s.address, s.gstin, s.notes, s.balance_paise, bool(true), updated_at);
  await enqueue('upsert:suppliers', { id, shop_id: shopId, name: s.name, phone: s.phone, address: s.address, gstin: s.gstin, notes: s.notes, is_active: true }, 'suppliers', id);
  return s;
}

export async function supplierLedger(supplierId: string, limit = 100): Promise<SupplierLedgerEntry[]> {
  const db = await getDb();
  return db.getAllAsync<SupplierLedgerEntry>('select * from supplier_ledger_entries where supplier_id = ? order by entry_date desc, client_created_at desc limit ?', supplierId, limit);
}

export async function recordSupplierPayment(args: { shopId: string; memberId: string; shiftId: string | null; supplierId: string; method: 'cash' | 'upi'; amountPaise: number; note?: string }): Promise<SupplierLedgerEntry> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const e: SupplierLedgerEntry = { id, supplier_id: args.supplierId, entry_type: 'payment', amount_paise: -args.amountPaise, purchase_id: null, payment_method: args.method, entry_date: todayLocal(), note: args.note ?? null, client_created_at: at };
  await db.withTransactionAsync(async () => {
    await db.runAsync('insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, purchase_id, payment_method, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, args.supplierId, args.memberId, args.shiftId, 'payment', -args.amountPaise, null, args.method, e.entry_date, e.note, at);
    await db.runAsync('update suppliers set balance_paise = balance_paise - ? where id = ?', args.amountPaise, args.supplierId);
  });
  await enqueue('post_supplier_payment', { p: { id, supplier_id: args.supplierId, method: args.method, amount_paise: args.amountPaise, note: args.note ?? null, entry_date: e.entry_date, client_created_at: at } }, 'supplier_ledger_entries', id);
  return e;
}

export async function recordSupplierEntry(args: { shopId: string; memberId: string; supplierId: string; entryType: 'opening_balance' | 'adjustment'; amountPaise: number; note?: string; entryDate?: string }): Promise<void> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const date = args.entryDate ?? todayLocal();
  await db.withTransactionAsync(async () => {
    await db.runAsync('insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, purchase_id, payment_method, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, args.supplierId, args.memberId, null, args.entryType, args.amountPaise, null, null, date, args.note ?? null, at);
    await db.runAsync('update suppliers set balance_paise = balance_paise + ? where id = ?', args.amountPaise, args.supplierId);
  });
  await enqueue('post_supplier_entry', { p: { id, supplier_id: args.supplierId, entry_type: args.entryType, amount_paise: args.amountPaise, note: args.note ?? null, entry_date: date, client_created_at: at } }, 'supplier_ledger_entries', id);
}

export async function totalPayable(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ s: number | null }>('select sum(balance_paise) s from suppliers where balance_paise > 0');
  return r?.s ?? 0;
}
