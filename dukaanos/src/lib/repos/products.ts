import Decimal from 'decimal.js';
import { bool, fromBool, getDb } from '@/lib/db';
import { newId, nowIso } from '@/lib/ids';
import { enqueue } from '@/lib/sync/outbox';
import type { Category, Product } from './types';

type Raw = Omit<Product, 'aliases' | 'is_loose' | 'is_quick' | 'is_active'> & { aliases: string; is_loose: number; is_quick: number; is_active: number };

function hydrate(r: Raw): Product {
  return { ...r, aliases: safeJson(r.aliases), is_loose: fromBool(r.is_loose), is_quick: fromBool(r.is_quick), is_active: fromBool(r.is_active) };
}
function safeJson(s: string): string[] {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export async function listProducts(opts: { search?: string; quickOnly?: boolean; includeInactive?: boolean; categoryId?: string | null } = {}): Promise<Product[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (!opts.includeInactive) where.push('is_active = 1');
  if (opts.quickOnly) where.push('is_quick = 1');
  if (opts.categoryId) { where.push('category_id = ?'); params.push(opts.categoryId); }
  if (opts.search?.trim()) {
    const s = `%${opts.search.trim().toLowerCase()}%`;
    where.push('(lower(name) like ? or lower(coalesce(name_hi, \'\')) like ? or lower(aliases) like ? or barcode = ?)');
    params.push(s, s, s, opts.search.trim());
  }
  const rows = await db.getAllAsync<Raw>(`select * from products ${where.length ? 'where ' + where.join(' and ') : ''} order by is_quick desc, quick_sort, name limit 500`, ...params);
  return rows.map(hydrate);
}

export async function getProduct(id: string): Promise<Product | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Raw>('select * from products where id = ?', id);
  return r ? hydrate(r) : null;
}

export async function getProductByBarcode(code: string): Promise<Product | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Raw>('select * from products where barcode = ? and is_active = 1', code);
  return r ? hydrate(r) : null;
}

export async function listCategories(): Promise<Category[]> {
  const db = await getDb();
  return db.getAllAsync<Category>('select * from categories order by sort_order, name');
}

export type ProductInput = Omit<Product, 'id' | 'shop_id' | 'stock_qty' | 'updated_at'> & { id?: string };

/** Create/update a product locally and queue the server upsert (managers only — RLS enforces). */
export async function saveProduct(shopId: string, input: ProductInput): Promise<Product> {
  const db = await getDb();
  const id = input.id ?? newId();
  const existing = input.id ? await getProduct(input.id) : null;
  const updated_at = nowIso();
  const product: Product = { ...input, id, shop_id: shopId, stock_qty: existing?.stock_qty ?? '0', updated_at };
  await db.runAsync(
    `insert or replace into products(id, shop_id, category_id, name, name_hi, aliases, unit, is_loose, selling_price_paise, purchase_price_paise, barcode, min_stock_qty, stock_qty, is_quick, quick_sort, is_active, updated_at, dirty)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
    id, shopId, product.category_id, product.name, product.name_hi, JSON.stringify(product.aliases), product.unit, bool(product.is_loose), product.selling_price_paise,
    product.purchase_price_paise, product.barcode || null, product.min_stock_qty, product.stock_qty, bool(product.is_quick), product.quick_sort, bool(product.is_active), updated_at,
  );
  // Server row: exclude stock_qty (cache owned by the server triggers)
  await enqueue('upsert:products', {
    id, shop_id: shopId, category_id: product.category_id, name: product.name, name_hi: product.name_hi, aliases: product.aliases, unit: product.unit, is_loose: product.is_loose,
    selling_price_paise: product.selling_price_paise, purchase_price_paise: product.purchase_price_paise, barcode: product.barcode || null, min_stock_qty: product.min_stock_qty,
    is_quick: product.is_quick, quick_sort: product.quick_sort, is_active: product.is_active,
  }, 'products', id);
  return product;
}

/** Local optimistic stock change (server triggers are authoritative; pull replaces this value). */
export async function bumpLocalStock(productId: string, delta: string): Promise<void> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ stock_qty: string }>('select stock_qty from products where id = ?', productId);
  if (!r) return;
  const next = new Decimal(r.stock_qty || '0').plus(delta).toDecimalPlaces(3).toString();
  await db.runAsync('update products set stock_qty = ? where id = ?', next, productId);
}

export async function lowStockProducts(): Promise<Product[]> {
  const all = await listProducts();
  return all.filter((p) => new Decimal(p.min_stock_qty).gt(0) && new Decimal(p.stock_qty).lte(p.min_stock_qty));
}
