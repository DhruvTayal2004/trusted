/**
 * Local SQLite schema. Mirrors the server tables the device needs offline, plus the sync outbox.
 * Money columns are INTEGER paise; quantities are TEXT decimals (exact), dates are ISO TEXT.
 */
export const LOCAL_SCHEMA_VERSION = 1;

export const LOCAL_SCHEMA = `
create table if not exists kv (key text primary key, value text not null);

create table if not exists categories (
  id text primary key, shop_id text not null, name text not null, sort_order integer not null default 0, updated_at text not null
);
create table if not exists products (
  id text primary key, shop_id text not null, category_id text, name text not null, name_hi text, aliases text not null default '[]',
  unit text not null, is_loose integer not null default 0, selling_price_paise integer not null, purchase_price_paise integer,
  barcode text, min_stock_qty text not null default '0', stock_qty text not null default '0', is_quick integer not null default 0,
  quick_sort integer not null default 0, is_active integer not null default 1, updated_at text not null, dirty integer not null default 0
);
create index if not exists products_name on products(name);
create index if not exists products_barcode on products(barcode);

create table if not exists customers (
  id text primary key, shop_id text not null, name text not null, phone text, address text, notes text,
  balance_paise integer not null default 0, credit_limit_paise integer, is_active integer not null default 1, updated_at text not null, dirty integer not null default 0
);
create index if not exists customers_name on customers(name);
create index if not exists customers_phone on customers(phone);

create table if not exists suppliers (
  id text primary key, shop_id text not null, name text not null, phone text, address text, gstin text, notes text,
  balance_paise integer not null default 0, is_active integer not null default 1, updated_at text not null, dirty integer not null default 0
);

create table if not exists expense_categories (id text primary key, shop_id text not null, name text not null, requires_approval integer not null default 0);

create table if not exists members (
  id text primary key, shop_id text not null, display_name text not null, role text not null, is_active integer not null default 1, permissions text not null default '{}', updated_at text not null
);

create table if not exists shifts (
  id text primary key, shop_id text not null, member_id text not null, status text not null, opened_at text not null, opening_cash_paise integer not null,
  closed_at text, expected_cash_paise integer, counted_cash_paise integer, cash_difference_paise integer, closing_notes text, updated_at text not null
);

create table if not exists sales (
  id text primary key, shop_id text not null, member_id text not null, shift_id text, customer_id text, status text not null default 'completed',
  subtotal_paise integer not null, discount_paise integer not null default 0, total_paise integer not null, discount_reason text, note text,
  source text not null default 'manual', client_created_at text not null, updated_at text not null
);
create index if not exists sales_time on sales(client_created_at desc);
create index if not exists sales_shift on sales(shift_id);

create table if not exists sale_items (
  id text primary key, sale_id text not null, shop_id text not null, product_id text, description text not null, unit text not null,
  qty text not null, unit_price_paise integer not null, line_total_paise integer not null
);
create index if not exists sale_items_sale on sale_items(sale_id);

create table if not exists payments (
  id text primary key, shop_id text not null, sale_id text, customer_id text, member_id text not null, shift_id text, method text not null,
  status text not null default 'received', amount_paise integer not null, upi_reference text, note text, client_created_at text not null, updated_at text not null
);
create index if not exists payments_shift on payments(shift_id);
create index if not exists payments_customer on payments(customer_id);

create table if not exists refunds (
  id text primary key, shop_id text not null, sale_id text not null, member_id text not null, shift_id text, method text not null,
  amount_paise integer not null, reason text not null, restock integer not null default 0, client_created_at text not null
);

create table if not exists customer_ledger_entries (
  id text primary key, shop_id text not null, customer_id text not null, member_id text, entry_type text not null, amount_paise integer not null,
  sale_id text, payment_id text, entry_date text not null, note text, client_created_at text not null
);
create index if not exists cle_customer on customer_ledger_entries(customer_id, entry_date desc);

create table if not exists supplier_ledger_entries (
  id text primary key, shop_id text not null, supplier_id text not null, member_id text, shift_id text, entry_type text not null, amount_paise integer not null,
  purchase_id text, payment_method text, entry_date text not null, note text, client_created_at text not null
);
create index if not exists sle_supplier on supplier_ledger_entries(supplier_id, entry_date desc);

create table if not exists purchases (
  id text primary key, shop_id text not null, supplier_id text, member_id text not null, invoice_number text, invoice_date text not null, invoice_image_path text,
  subtotal_paise integer not null, total_paise integer not null, paid_paise integer not null default 0, paid_method text, note text, client_created_at text not null, updated_at text not null
);
create table if not exists purchase_items (
  id text primary key, purchase_id text not null, shop_id text not null, product_id text, description text not null, unit text not null, qty text not null,
  unit_cost_paise integer not null, line_total_paise integer not null
);

create table if not exists expenses (
  id text primary key, shop_id text not null, member_id text not null, shift_id text, category_id text, category_name text not null, amount_paise integer not null,
  paid_method text not null, expense_date text not null, note text, receipt_image_path text, status text not null, client_created_at text not null, updated_at text not null
);
create index if not exists expenses_date on expenses(expense_date desc);

create table if not exists stock_movements (
  id text primary key, shop_id text not null, product_id text not null, member_id text, movement_type text not null, qty_delta text not null,
  unit_cost_paise integer, sale_id text, purchase_id text, reason text, client_created_at text not null
);
create index if not exists sm_product on stock_movements(product_id, client_created_at desc);

-- Outbox: every offline write, pushed in order. Never deleted on failure.
create table if not exists outbox (
  op_id text primary key, seq integer not null, rpc text not null, payload text not null, record_table text not null, record_id text not null,
  status text not null default 'pending',     -- pending | sent | rejected
  attempts integer not null default 0, last_error text, created_at text not null, sent_at text
);
create index if not exists outbox_status on outbox(status, seq);

create table if not exists sync_conflicts (
  id text primary key, table_name text not null, record_id text not null, local_value text, server_value text, detected_at text not null, resolved integer not null default 0
);
`;
