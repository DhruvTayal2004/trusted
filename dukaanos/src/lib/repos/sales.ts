import Decimal from 'decimal.js';
import { buildSalePayload, type CartLine, type CartPaymentPart } from '@/core/cart';
import { getDb } from '@/lib/db';
import { newId, nowIso, todayLocal } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import { bumpLocalBalance } from './customers';
import { bumpLocalStock } from './products';
import type { Payment, Sale, SaleItem } from './types';

/**
 * Record a sale offline-first:
 *  1. write sale, items, payments, ledger entry (credit), stock movements to SQLite in one transaction
 *  2. apply optimistic stock/balance changes
 *  3. enqueue `post_sale` with the identical payload (idempotent on sale id)
 */
export async function createSale(args: {
  shopId: string; memberId: string; shiftId: string | null; lines: CartLine[]; discountPaise: number; discountReason?: string;
  payments: CartPaymentPart[]; customerId: string | null; note?: string; source: 'manual' | 'voice' | 'barcode' | 'quick';
}): Promise<Sale> {
  const db = await getDb();
  const id = newId();
  const opId = newId();
  const at = nowIso();
  const payload = buildSalePayload({ id, opId, lines: args.lines, discountPaise: args.discountPaise, discountReason: args.discountReason, payments: args.payments, customerId: args.customerId, note: args.note, source: args.source, clientCreatedAt: at });

  const sale: Sale = {
    id, shop_id: args.shopId, member_id: args.memberId, shift_id: args.shiftId, customer_id: args.customerId, status: 'completed',
    subtotal_paise: payload.subtotal_paise, discount_paise: payload.discount_paise, total_paise: payload.total_paise,
    discount_reason: args.discountReason ?? null, note: args.note ?? null, source: args.source, client_created_at: at, updated_at: at,
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'insert into sales(id, shop_id, member_id, shift_id, customer_id, status, subtotal_paise, discount_paise, total_paise, discount_reason, note, source, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id, args.shopId, args.memberId, args.shiftId, args.customerId, 'completed', sale.subtotal_paise, sale.discount_paise, sale.total_paise, sale.discount_reason, sale.note, args.source, at, at,
    );
    for (const it of payload.items) {
      await db.runAsync('insert into sale_items(id, sale_id, shop_id, product_id, description, unit, qty, unit_price_paise, line_total_paise) values (?,?,?,?,?,?,?,?,?)',
        it.id, id, args.shopId, it.product_id, it.description, it.unit, it.qty, it.unit_price_paise, it.line_total_paise);
      if (it.product_id) {
        await db.runAsync('insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, sale_id, purchase_id, reason, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
          newId(), args.shopId, it.product_id, args.memberId, 'sale', new Decimal(it.qty).neg().toString(), null, id, null, null, at);
        await bumpLocalStock(it.product_id, new Decimal(it.qty).neg().toString());
      }
    }
    for (const p of payload.payments) {
      await db.runAsync('insert into payments(id, shop_id, sale_id, customer_id, member_id, shift_id, method, status, amount_paise, upi_reference, note, client_created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        p.id, args.shopId, id, args.customerId, args.memberId, args.shiftId, p.method, p.method === 'upi' ? 'pending_verification' : 'received', p.amount_paise, p.upi_reference, null, at, at);
      if (p.method === 'credit' && args.customerId) {
        await db.runAsync('insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, sale_id, payment_id, entry_date, note, client_created_at) values (?,?,?,?,?,?,?,?,?,?,?)',
          newId(), args.shopId, args.customerId, args.memberId, 'credit_sale', p.amount_paise, id, p.id, todayLocal(), null, at);
        await bumpLocalBalance(args.customerId, p.amount_paise);
      }
    }
  });
  await enqueue('post_sale', { p: payload }, 'sales', id, opId);
  return sale;
}

export async function listSales(opts: { shiftId?: string; date?: string; memberId?: string; limit?: number } = {}): Promise<(Sale & { items_summary: string; methods: string })[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.shiftId) { where.push('s.shift_id = ?'); params.push(opts.shiftId); }
  if (opts.memberId) { where.push('s.member_id = ?'); params.push(opts.memberId); }
  if (opts.date) { where.push('substr(s.client_created_at, 1, 10) = ?'); params.push(opts.date); }
  return db.getAllAsync(
    `select s.*,
       (select group_concat(description || ' ×' || qty, ', ') from sale_items si where si.sale_id = s.id) as items_summary,
       (select group_concat(distinct method) from payments p where p.sale_id = s.id) as methods
     from sales s ${where.length ? 'where ' + where.join(' and ') : ''} order by s.client_created_at desc limit ?`,
    ...params, opts.limit ?? 100,
  );
}

export async function getSaleDetail(id: string): Promise<{ sale: Sale; items: SaleItem[]; payments: Payment[] } | null> {
  const db = await getDb();
  const sale = await db.getFirstAsync<Sale>('select * from sales where id = ?', id);
  if (!sale) return null;
  const items = await db.getAllAsync<SaleItem>('select * from sale_items where sale_id = ?', id);
  const payments = await db.getAllAsync<Payment>('select * from payments where sale_id = ?', id);
  return { sale, items, payments };
}

export async function setLocalUpiStatus(paymentId: string, status: 'verified' | 'failed' | 'pending_verification', reference?: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('update payments set status = ?, upi_reference = coalesce(?, upi_reference), updated_at = ? where id = ?', status, reference ?? null, nowIso(), paymentId);
  await enqueue('set_upi_payment_status', { p_payment_id: paymentId, p_status: status, p_reference: reference ?? null }, 'payments', paymentId);
}

export async function createRefund(args: { shopId: string; memberId: string; shiftId: string | null; saleId: string; method: 'cash' | 'upi' | 'credit'; amountPaise: number; reason: string; restock: boolean }): Promise<void> {
  const db = await getDb();
  const id = newId();
  const at = nowIso();
  await db.runAsync('insert into refunds(id, shop_id, sale_id, member_id, shift_id, method, amount_paise, reason, restock, client_created_at) values (?,?,?,?,?,?,?,?,?,?)',
    id, args.shopId, args.saleId, args.memberId, args.shiftId, args.method, args.amountPaise, args.reason, args.restock ? 1 : 0, at);
  await enqueue('post_refund', { p: { id, sale_id: args.saleId, method: args.method, amount_paise: args.amountPaise, reason: args.reason, restock: args.restock, client_created_at: at } }, 'refunds', id);
}

export async function pendingUpiPayments(limit = 50): Promise<Payment[]> {
  const db = await getDb();
  return db.getAllAsync<Payment>(`select * from payments where method = 'upi' and status = 'pending_verification' order by client_created_at desc limit ?`, limit);
}
