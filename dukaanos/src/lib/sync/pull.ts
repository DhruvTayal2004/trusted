import { bool, getDb } from '@/lib/db';
import { newId, nowIso } from '@/lib/ids';

type Row = Record<string, unknown>;

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const int = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Upsert pulled server rows into the local mirror. Server is authoritative for everything it returns
 * (caches like stock_qty / balance_paise are replaced by server values). Local rows that are `dirty`
 * (edited offline, not yet pushed) are kept and a conflict is logged when the server copy also changed.
 */
export async function applyPulledChanges(p: Record<string, unknown[]> & { server_time: string }): Promise<{ maxUpdatedAt: string | null; hitLimit: boolean }> {
  const db = await getDb();
  let maxUpdatedAt: string | null = null;
  let hitLimit = false;
  const track = (rows: unknown[], key = 'updated_at') => {
    if (rows.length >= 500) hitLimit = true;
    for (const r of rows as Row[]) {
      const u = str(r[key]);
      if (u && (!maxUpdatedAt || u > maxUpdatedAt)) maxUpdatedAt = u;
    }
  };

  await db.withTransactionAsync(async () => {
    for (const r of (p.categories ?? []) as Row[]) {
      await db.runAsync('insert or replace into categories(id, shop_id, name, sort_order, updated_at) values (?,?,?,?,?)', str(r.id), str(r.shop_id), str(r.name), int(r.sort_order) ?? 0, str(r.updated_at));
    }
    track(p.categories ?? []);

    for (const r of (p.products ?? []) as Row[]) {
      const local = await db.getFirstAsync<{ dirty: number; updated_at: string }>('select dirty, updated_at from products where id = ?', str(r.id));
      if (local?.dirty) {
        await logConflict(db, 'products', String(r.id), local, r);
        continue;
      }
      await db.runAsync(
        `insert or replace into products(id, shop_id, category_id, name, name_hi, aliases, unit, is_loose, selling_price_paise, purchase_price_paise, barcode, min_stock_qty, stock_qty, is_quick, quick_sort, is_active, updated_at, dirty)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        str(r.id), str(r.shop_id), str(r.category_id), str(r.name), str(r.name_hi), JSON.stringify(r.aliases ?? []), str(r.unit), bool(r.is_loose),
        int(r.selling_price_paise), int(r.purchase_price_paise), str(r.barcode), str(r.min_stock_qty) ?? '0', str(r.stock_qty) ?? '0', bool(r.is_quick), int(r.quick_sort) ?? 0, bool(r.is_active), str(r.updated_at),
      );
    }
    track(p.products ?? []);

    for (const r of (p.customers ?? []) as Row[]) {
      const local = await db.getFirstAsync<{ dirty: number; updated_at: string }>('select dirty, updated_at from customers where id = ?', str(r.id));
      if (local?.dirty) {
        await logConflict(db, 'customers', String(r.id), local, r);
        continue;
      }
      await db.runAsync(
        'insert or replace into customers(id, shop_id, name, phone, address, notes, balance_paise, credit_limit_paise, is_active, updated_at, dirty) values (?,?,?,?,?,?,?,?,?,?,0)',
        str(r.id), str(r.shop_id), str(r.name), str(r.phone), str(r.address), str(r.notes), int(r.balance_paise) ?? 0, int(r.credit_limit_paise), bool(r.is_active), str(r.updated_at),
      );
    }
    track(p.customers ?? []);

    for (const r of (p.suppliers ?? []) as Row[]) {
      const local = await db.getFirstAsync<{ dirty: number; updated_at: string }>('select dirty, updated_at from suppliers where id = ?', str(r.id));
      if (local?.dirty) {
        await logConflict(db, 'suppliers', String(r.id), local, r);
        continue;
      }
      await db.runAsync(
        'insert or replace into suppliers(id, shop_id, name, phone, address, gstin, notes, balance_paise, is_active, updated_at, dirty) values (?,?,?,?,?,?,?,?,?,?,0)',
        str(r.id), str(r.shop_id), str(r.name), str(r.phone), str(r.address), str(r.gstin), str(r.notes), int(r.balance_paise) ?? 0, bool(r.is_active), str(r.updated_at),
      );
    }
    track(p.suppliers ?? []);

    for (const r of (p.expense_categories ?? []) as Row[]) {
      await db.runAsync('insert or replace into expense_categories(id, shop_id, name, requires_approval) values (?,?,?,?)', str(r.id), str(r.shop_id), str(r.name), bool(r.requires_approval));
    }
    for (const r of (p.members ?? []) as Row[]) {
      await db.runAsync('insert or replace into members(id, shop_id, display_name, role, is_active, permissions, updated_at) values (?,?,?,?,?,?,?)', str(r.id), str(r.shop_id ?? ''), str(r.display_name), str(r.role), bool(r.is_active), JSON.stringify(r.permissions ?? {}), str(r.updated_at) ?? nowIso());
    }

    for (const r of (p.shifts ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into shifts(id, shop_id, member_id, status, opened_at, opening_cash_paise, closed_at, expected_cash_paise, counted_cash_paise, cash_difference_paise, closing_notes, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.shop_id), str(r.member_id), str(r.status), str(r.opened_at), int(r.opening_cash_paise) ?? 0, str(r.closed_at), int(r.expected_cash_paise), int(r.counted_cash_paise), int(r.cash_difference_paise), str(r.closing_notes), str(r.updated_at),
      );
    }
    track(p.shifts ?? []);

    for (const r of (p.sales ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into sales(id, shop_id, member_id, shift_id, customer_id, status, subtotal_paise, discount_paise, total_paise, discount_reason, note, source, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.shop_id), str(r.member_id), str(r.shift_id), str(r.customer_id), str(r.status), int(r.subtotal_paise), int(r.discount_paise) ?? 0, int(r.total_paise), str(r.discount_reason), str(r.note), str(r.source) ?? 'manual', str(r.client_created_at), str(r.updated_at),
      );
    }
    track(p.sales ?? []);
    for (const r of (p.sale_items ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into sale_items(id, sale_id, shop_id, product_id, description, unit, qty, unit_price_paise, line_total_paise) values (?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.sale_id), str(r.shop_id), str(r.product_id), str(r.description), str(r.unit), str(r.qty), int(r.unit_price_paise), int(r.line_total_paise),
      );
    }
    for (const r of (p.payments ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into payments(id, shop_id, sale_id, customer_id, member_id, shift_id, method, status, amount_paise, upi_reference, note, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.shop_id), str(r.sale_id), str(r.customer_id), str(r.member_id), str(r.shift_id), str(r.method), str(r.status), int(r.amount_paise), str(r.upi_reference), str(r.note), str(r.client_created_at), str(r.updated_at),
      );
    }
    track(p.payments ?? []);
    for (const r of (p.customer_ledger_entries ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, sale_id, payment_id, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.shop_id), str(r.customer_id), str(r.member_id), str(r.entry_type), int(r.amount_paise), str(r.sale_id), str(r.payment_id), str(r.entry_date), str(r.note), str(r.client_created_at),
      );
    }
    track(p.customer_ledger_entries ?? [], 'created_at');
    for (const r of (p.expenses ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into expenses(id, shop_id, member_id, shift_id, category_id, category_name, amount_paise, paid_method, expense_date, note, receipt_image_path, status, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.shop_id), str(r.member_id), str(r.shift_id), str(r.category_id), str(r.category_name), int(r.amount_paise), str(r.paid_method), str(r.expense_date), str(r.note), str(r.receipt_image_path), str(r.status), str(r.client_created_at), str(r.updated_at),
      );
    }
    track(p.expenses ?? []);
    for (const r of (p.stock_movements ?? []) as Row[]) {
      await db.runAsync(
        'insert or replace into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, sale_id, purchase_id, reason, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
        str(r.id), str(r.shop_id), str(r.product_id), str(r.member_id), str(r.movement_type), str(r.qty_delta), int(r.unit_cost_paise), str(r.sale_id), str(r.purchase_id), str(r.reason), str(r.client_created_at),
      );
    }
    track(p.stock_movements ?? [], 'created_at');
  });
  return { maxUpdatedAt, hitLimit };
}

async function logConflict(db: Awaited<ReturnType<typeof getDb>>, table: string, id: string, local: unknown, server: unknown) {
  await db.runAsync(
    'insert into sync_conflicts(id, table_name, record_id, local_value, server_value, detected_at, resolved) values (?,?,?,?,?,?,0)',
    newId(), table, id, JSON.stringify(local), JSON.stringify(server), nowIso(),
  );
}
