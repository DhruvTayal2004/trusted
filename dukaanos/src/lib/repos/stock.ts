import Decimal from 'decimal.js';
import { getDb } from '@/lib/db';
import { newId, nowIso, todayLocal } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import { bumpLocalStock } from './products';
import type { Purchase, StockMovement } from './types';

export type AdjustmentType = 'opening' | 'damage' | 'expiry' | 'wastage' | 'manual_adjustment' | 'return_to_supplier';

export const ADJUSTMENT_LABELS: Record<AdjustmentType, string> = {
  opening: 'Opening stock',
  damage: 'Damaged',
  expiry: 'Expired',
  wastage: 'Wastage',
  manual_adjustment: 'Manual correction',
  return_to_supplier: 'Returned to supplier',
};

export async function recordAdjustment(args: { shopId: string; memberId: string; productId: string; type: AdjustmentType; qtyDelta: string; reason: string; unitCostPaise?: number | null }): Promise<StockMovement> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const mv: StockMovement = { id, product_id: args.productId, member_id: args.memberId, movement_type: args.type, qty_delta: args.qtyDelta, unit_cost_paise: args.unitCostPaise ?? null, sale_id: null, purchase_id: null, reason: args.reason, client_created_at: at };
  await db.withTransactionAsync(async () => {
    await db.runAsync('insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, sale_id, purchase_id, reason, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, args.productId, args.memberId, args.type, args.qtyDelta, mv.unit_cost_paise, null, null, args.reason, at);
    await bumpLocalStock(args.productId, args.qtyDelta);
  });
  await enqueue('post_stock_adjustment', { p: { id, product_id: args.productId, movement_type: args.type, qty_delta: args.qtyDelta, reason: args.reason, unit_cost_paise: mv.unit_cost_paise, client_created_at: at } }, 'stock_movements', id);
  return mv;
}

export async function movementsForProduct(productId: string, limit = 100): Promise<StockMovement[]> {
  const db = await getDb();
  return db.getAllAsync<StockMovement>('select * from stock_movements where product_id = ? order by client_created_at desc limit ?', productId, limit);
}

export interface PurchaseLineInput { id?: string; productId: string | null; description: string; unit: string; qty: string; unitCostPaise: number; updatePurchasePrice?: boolean }

export async function receivePurchase(args: { shopId: string; memberId: string; supplierId: string | null; invoiceNumber?: string; invoiceDate?: string; invoiceImagePath?: string | null; note?: string; lines: PurchaseLineInput[]; paidPaise: number; paidMethod: 'cash' | 'upi' | null; shiftId: string | null }): Promise<Purchase> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const items = args.lines.map((l) => ({ id: l.id ?? newId(), product_id: l.productId, description: l.description, unit: l.unit, qty: l.qty, unit_cost_paise: l.unitCostPaise, line_total_paise: Number(new Decimal(l.unitCostPaise).mul(l.qty).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)), update_purchase_price: l.updatePurchasePrice ?? true }));
  const total = items.reduce((a, i) => a + i.line_total_paise, 0);
  if (total <= 0) throw new Error('Purchase needs at least one item');
  if (args.paidPaise < 0 || args.paidPaise > total) throw new Error('Paid amount must be between 0 and the total');
  const invoiceDate = args.invoiceDate ?? todayLocal();
  const purchase: Purchase = { id, supplier_id: args.supplierId, member_id: args.memberId, invoice_number: args.invoiceNumber ?? null, invoice_date: invoiceDate, invoice_image_path: args.invoiceImagePath ?? null, subtotal_paise: total, total_paise: total, paid_paise: args.paidPaise, paid_method: args.paidMethod, note: args.note ?? null, client_created_at: at };
  await db.withTransactionAsync(async () => {
    await db.runAsync('insert into purchases(id, shop_id, supplier_id, member_id, invoice_number, invoice_date, invoice_image_path, subtotal_paise, total_paise, paid_paise, paid_method, note, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, purchase.supplier_id, args.memberId, purchase.invoice_number, invoiceDate, purchase.invoice_image_path, total, total, args.paidPaise, args.paidMethod, purchase.note, at, at);
    for (const it of items) {
      await db.runAsync('insert into purchase_items(id, purchase_id, shop_id, product_id, description, unit, qty, unit_cost_paise, line_total_paise) values (?,?,?,?,?,?,?,?,?)', it.id, id, args.shopId, it.product_id, it.description, it.unit, it.qty, it.unit_cost_paise, it.line_total_paise);
      if (it.product_id) {
        await db.runAsync('insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, sale_id, purchase_id, reason, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
          newId(), args.shopId, it.product_id, args.memberId, 'purchase', it.qty, it.unit_cost_paise, null, id, null, at);
        await bumpLocalStock(it.product_id, it.qty);
        if (it.update_purchase_price) await db.runAsync('update products set purchase_price_paise = ? where id = ?', it.unit_cost_paise, it.product_id);
      }
    }
    if (args.supplierId) {
      await db.runAsync('insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, purchase_id, payment_method, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
        newId(), args.shopId, args.supplierId, args.memberId, args.shiftId, 'purchase', total, id, null, invoiceDate, `Invoice ${args.invoiceNumber ?? ''}`.trim(), at);
      let delta = total;
      if (args.paidPaise > 0) {
        await db.runAsync('insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, purchase_id, payment_method, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?,?)',
          newId(), args.shopId, args.supplierId, args.memberId, args.shiftId, 'payment', -args.paidPaise, id, args.paidMethod ?? 'cash', invoiceDate, 'Paid on receipt', at);
        delta -= args.paidPaise;
      }
      await db.runAsync('update suppliers set balance_paise = balance_paise + ? where id = ?', delta, args.supplierId);
    }
  });
  await enqueue('receive_purchase', { p: { id, supplier_id: args.supplierId, invoice_number: purchase.invoice_number, invoice_date: invoiceDate, invoice_image_path: purchase.invoice_image_path, note: purchase.note, client_created_at: at, items, paid_paise: args.paidPaise, paid_method: args.paidMethod } }, 'purchases', id);
  return purchase;
}

export async function listPurchases(limit = 100): Promise<(Purchase & { supplier_name: string | null })[]> {
  const db = await getDb();
  return db.getAllAsync('select p.*, s.name as supplier_name from purchases p left join suppliers s on s.id = p.supplier_id order by p.invoice_date desc, p.client_created_at desc limit ?', limit);
}

/** Last purchase prices for a product across suppliers — for price comparison. */
export async function purchasePriceHistory(productId: string, limit = 20): Promise<{ invoice_date: string; supplier_name: string | null; unit_cost_paise: number; qty: string }[]> {
  const db = await getDb();
  return db.getAllAsync(
    `select p.invoice_date, s.name as supplier_name, pi.unit_cost_paise, pi.qty from purchase_items pi join purchases p on p.id = pi.purchase_id left join suppliers s on s.id = p.supplier_id
     where pi.product_id = ? order by p.invoice_date desc limit ?`, productId, limit,
  );
}

/** Physical count: items with system vs counted; finalises through RPC (creates count_adjustment movements server-side). */
export async function finaliseCount(args: { shopId: string; memberId: string; note?: string; items: { productId: string; countedQty: string }[] }): Promise<string> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  const items = [] as { id: string; product_id: string; counted_qty: string }[];
  await db.withTransactionAsync(async () => {
    for (const it of args.items) {
      const row = await db.getFirstAsync<{ stock_qty: string }>('select stock_qty from products where id = ?', it.productId);
      const sys = new Decimal(row?.stock_qty ?? '0');
      const delta = new Decimal(it.countedQty).minus(sys);
      items.push({ id: newId(), product_id: it.productId, counted_qty: it.countedQty });
      if (!delta.isZero()) {
        await db.runAsync('insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, sale_id, purchase_id, reason, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
          newId(), args.shopId, it.productId, args.memberId, 'count_adjustment', delta.toString(), null, null, null, `Physical count: system ${sys.toString()}, counted ${it.countedQty}`, at);
        await bumpLocalStock(it.productId, delta.toString());
      }
    }
  });
  await enqueue('finalise_stock_count', { p: { id, note: args.note ?? null, items } }, 'stock_counts', id);
  return id;
}
