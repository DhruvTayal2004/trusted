-- DukaanOS V1 — core schema
-- Conventions:
--   * All money is stored as integer PAISE (bigint). ₹1 = 100 paise. Never floats.
--   * Quantities are numeric(14,3) in the product's own unit (kg, g, l, ml, pc, pkt, bag).
--   * Financial tables are APPEND-ONLY events. Corrections are new rows that reference the original.
--   * Client generates UUID primary keys so offline writes are idempotent on sync.

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type member_role as enum ('owner', 'admin', 'employee');
create type product_unit as enum ('kg', 'g', 'l', 'ml', 'pc', 'pkt', 'bag');
create type payment_method as enum ('cash', 'upi', 'credit');
create type payment_status as enum ('received', 'pending_verification', 'verified', 'failed');
create type sale_status as enum ('completed', 'reversed', 'partially_refunded');
create type ledger_entry_type as enum ('opening_balance', 'credit_sale', 'payment', 'adjustment', 'notebook_import', 'reversal');
create type supplier_ledger_type as enum ('opening_balance', 'purchase', 'payment', 'adjustment', 'notebook_import', 'reversal');
create type expense_status as enum ('recorded', 'pending_approval', 'approved', 'rejected');
create type stock_movement_type as enum ('opening', 'purchase', 'sale', 'sale_reversal', 'damage', 'expiry', 'wastage', 'count_adjustment', 'manual_adjustment', 'notebook_import', 'return_to_supplier');
create type shift_status as enum ('open', 'closed');
create type scan_kind as enum ('customer_khata', 'supplier_khata', 'expenses', 'purchases', 'sales');
create type scan_status as enum ('uploaded', 'processing', 'extracted', 'failed', 'reviewed', 'imported');
create type scan_entry_status as enum ('pending', 'approved', 'rejected', 'duplicate', 'imported');
create type notification_status as enum ('queued', 'sent', 'failed', 'skipped_no_provider');

-- ---------------------------------------------------------------------------
-- Shops & membership
-- ---------------------------------------------------------------------------
create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references auth.users(id),
  phone text,
  address text,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A member is a person who can act in a shop. Each member has their own auth.users row so
-- RLS can identify who is acting. Employees sign in with a PIN via the `pin-login` edge function.
create table shop_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  role member_role not null default 'employee',
  display_name text not null,
  phone text,
  pin_hash text,                       -- bcrypt via pgcrypto, only for employees/admins using PIN login
  pin_failed_attempts int not null default 0,
  pin_locked_until timestamptz,
  permissions jsonb not null default '{"can_refund":false,"can_discount":false,"max_discount_pct":0,"can_receive_stock":false,"can_adjust_stock":false,"can_record_expense":true,"can_view_purchase_price":false}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on shop_members(shop_id);
create index on shop_members(user_id);

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------
create table categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  name_hi text,                          -- Hindi / Hinglish display name (e.g. "चावल", "chawal")
  aliases text[] not null default '{}',  -- voice / search aliases: {"chawal","rice","chaval"}
  unit product_unit not null default 'pc',
  is_loose boolean not null default false, -- loose goods sold by weight/volume
  selling_price_paise bigint not null check (selling_price_paise >= 0),   -- per unit
  purchase_price_paise bigint check (purchase_price_paise >= 0),          -- per unit, last known
  barcode text,
  min_stock_qty numeric(14,3) not null default 0,
  stock_qty numeric(14,3) not null default 0,  -- CACHE: maintained by trigger from stock_movements
  is_quick boolean not null default false,     -- show on quick-buttons grid
  quick_sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on products(shop_id);
create index on products(shop_id, barcode) where barcode is not null;
create index products_name_trgm on products using gin (name gin_trgm_ops);

create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  notes text,
  balance_paise bigint not null default 0,   -- CACHE: +ve = customer owes shop. Maintained by trigger.
  credit_limit_paise bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on customers(shop_id);
create index customers_name_trgm on customers using gin (name gin_trgm_ops);
create index on customers(shop_id, phone) where phone is not null;

create table suppliers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  gstin text,
  notes text,
  balance_paise bigint not null default 0,   -- CACHE: +ve = shop owes supplier
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on suppliers(shop_id);

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
create table shifts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  member_id uuid not null references shop_members(id),
  status shift_status not null default 'open',
  opened_at timestamptz not null default now(),
  opening_cash_paise bigint not null default 0,
  closed_at timestamptz,
  -- Snapshot at close time (deterministic, computed server-side in close_shift RPC)
  expected_cash_paise bigint,
  counted_cash_paise bigint,
  cash_difference_paise bigint,          -- counted - expected
  cash_sales_paise bigint,
  cash_received_paise bigint,            -- khata payments in cash
  cash_refunds_paise bigint,
  cash_expenses_paise bigint,
  cash_paid_out_paise bigint,            -- supplier payments / paid out in cash
  upi_sales_paise bigint,
  upi_received_paise bigint,
  upi_verified_paise bigint,
  credit_sales_paise bigint,
  closing_notes text,
  handover_to_member_id uuid references shop_members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on shifts(shop_id, status);
create index on shifts(shop_id, member_id, opened_at desc);
-- One open shift per member at a time
create unique index shifts_one_open_per_member on shifts(member_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Sales (append-only)
-- ---------------------------------------------------------------------------
create table sales (
  id uuid primary key,                               -- client-generated
  shop_id uuid not null references shops(id) on delete cascade,
  member_id uuid not null references shop_members(id),
  shift_id uuid references shifts(id),
  customer_id uuid references customers(id),
  status sale_status not null default 'completed',
  subtotal_paise bigint not null check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  total_paise bigint not null check (total_paise >= 0),
  discount_reason text,
  note text,
  source text not null default 'manual',             -- manual | voice | barcode | quick
  client_created_at timestamptz not null,            -- device time when recorded (offline-safe)
  created_at timestamptz not null default now(),     -- server receive time
  updated_at timestamptz not null default now()
);
create index on sales(shop_id, client_created_at desc);
create index on sales(shop_id, shift_id);
create index on sales(shop_id, customer_id);

create table sale_items (
  id uuid primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  product_id uuid references products(id),
  description text not null,                         -- snapshot of product name (or free text)
  unit product_unit not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  line_total_paise bigint not null check (line_total_paise >= 0),
  created_at timestamptz not null default now()
);
create index on sale_items(sale_id);
create index on sale_items(shop_id, product_id);

create table payments (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  sale_id uuid references sales(id) on delete cascade,  -- null when this is a khata payment
  customer_id uuid references customers(id),            -- set for khata collections and credit sales
  member_id uuid not null references shop_members(id),
  shift_id uuid references shifts(id),
  method payment_method not null,
  status payment_status not null default 'received',
  amount_paise bigint not null check (amount_paise > 0),
  upi_reference text,
  note text,
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on payments(shop_id, shift_id);
create index on payments(shop_id, customer_id);
create index on payments(sale_id);

create table refunds (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  sale_id uuid not null references sales(id),
  member_id uuid not null references shop_members(id),
  shift_id uuid references shifts(id),
  approved_by_member_id uuid references shop_members(id),
  method payment_method not null,                     -- how the money went back
  amount_paise bigint not null check (amount_paise > 0),
  reason text not null,
  restock boolean not null default false,
  client_created_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on refunds(shop_id, shift_id);

-- ---------------------------------------------------------------------------
-- Customer khata (ledger, append-only)
-- ---------------------------------------------------------------------------
create table customer_ledger_entries (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  member_id uuid references shop_members(id),
  entry_type ledger_entry_type not null,
  amount_paise bigint not null,                      -- +ve increases what customer owes; -ve reduces
  sale_id uuid references sales(id),
  payment_id uuid references payments(id),
  reverses_entry_id uuid references customer_ledger_entries(id),
  scan_entry_id uuid,                                 -- set when imported from a notebook
  entry_date date not null,                           -- the business date of the entry (may be historical)
  note text,
  client_created_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on customer_ledger_entries(shop_id, customer_id, entry_date desc);

-- ---------------------------------------------------------------------------
-- Suppliers & purchases
-- ---------------------------------------------------------------------------
create table purchases (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  supplier_id uuid references suppliers(id),
  member_id uuid not null references shop_members(id),
  invoice_number text,
  invoice_date date not null,
  invoice_image_path text,
  subtotal_paise bigint not null default 0,
  total_paise bigint not null default 0,
  paid_paise bigint not null default 0,            -- amount paid at time of receipt
  paid_method payment_method,
  note text,
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on purchases(shop_id, invoice_date desc);
create index on purchases(shop_id, supplier_id);

create table purchase_items (
  id uuid primary key,
  purchase_id uuid not null references purchases(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  product_id uuid references products(id),
  description text not null,
  unit product_unit not null,
  qty numeric(14,3) not null check (qty > 0),
  unit_cost_paise bigint not null check (unit_cost_paise >= 0),
  line_total_paise bigint not null,
  created_at timestamptz not null default now()
);
create index on purchase_items(purchase_id);
create index on purchase_items(shop_id, product_id, created_at desc);

create table supplier_ledger_entries (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  member_id uuid references shop_members(id),
  shift_id uuid references shifts(id),
  entry_type supplier_ledger_type not null,
  amount_paise bigint not null,                    -- +ve increases what shop owes; -ve reduces (payment)
  purchase_id uuid references purchases(id),
  payment_method payment_method,                   -- for payments: cash/upi
  reverses_entry_id uuid references supplier_ledger_entries(id),
  scan_entry_id uuid,
  entry_date date not null,
  note text,
  client_created_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on supplier_ledger_entries(shop_id, supplier_id, entry_date desc);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  name text not null,
  requires_approval boolean not null default false,
  created_at timestamptz not null default now(),
  unique (shop_id, name)
);

create table expenses (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  member_id uuid not null references shop_members(id),
  shift_id uuid references shifts(id),
  category_id uuid references expense_categories(id),
  category_name text not null,                      -- snapshot
  amount_paise bigint not null check (amount_paise > 0),
  paid_method payment_method not null default 'cash',
  expense_date date not null,
  note text,
  receipt_image_path text,
  status expense_status not null default 'recorded',
  approved_by_member_id uuid references shop_members(id),
  approved_at timestamptz,
  scan_entry_id uuid,
  client_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on expenses(shop_id, expense_date desc);
create index on expenses(shop_id, shift_id);
create index on expenses(shop_id, status);

-- ---------------------------------------------------------------------------
-- Inventory (stock_movements is the source of truth; products.stock_qty is a cache)
-- ---------------------------------------------------------------------------
create table stock_movements (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  product_id uuid not null references products(id),
  member_id uuid references shop_members(id),
  movement_type stock_movement_type not null,
  qty_delta numeric(14,3) not null,                 -- +ve in, -ve out
  unit_cost_paise bigint,
  sale_id uuid references sales(id),
  sale_item_id uuid references sale_items(id),
  purchase_id uuid references purchases(id),
  refund_id uuid references refunds(id),
  stock_count_id uuid,
  reverses_movement_id uuid references stock_movements(id),
  reason text,
  client_created_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on stock_movements(shop_id, product_id, created_at desc);
create index on stock_movements(shop_id, movement_type, created_at desc);

create table stock_counts (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  member_id uuid not null references shop_members(id),
  status text not null default 'draft' check (status in ('draft','finalised')),
  note text,
  started_at timestamptz not null default now(),
  finalised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table stock_count_items (
  id uuid primary key,
  stock_count_id uuid not null references stock_counts(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  product_id uuid not null references products(id),
  system_qty numeric(14,3) not null,               -- qty per system at time of count
  counted_qty numeric(14,3) not null,
  difference_qty numeric(14,3) generated always as (counted_qty - system_qty) stored,
  note text,
  created_at timestamptz not null default now()
);
create index on stock_count_items(stock_count_id);

-- ---------------------------------------------------------------------------
-- Notebook scanner
-- ---------------------------------------------------------------------------
create table notebook_scans (
  id uuid primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  member_id uuid not null references shop_members(id),
  kind scan_kind not null,
  batch_id uuid not null,                            -- groups several pages photographed together
  page_number int not null default 1,
  image_path text not null,                          -- Supabase Storage path (bucket: notebook-pages)
  status scan_status not null default 'uploaded',
  ai_provider text,
  ai_model text,
  raw_extraction jsonb,                              -- untouched model output, kept for audit
  page_notes text,                                   -- model's notes: unreadable areas, assumptions
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on notebook_scans(shop_id, batch_id);

create table notebook_entries (
  id uuid primary key,
  scan_id uuid not null references notebook_scans(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  row_index int not null,
  -- Extracted (model) values — never edited; owner's corrections go in *_final columns
  party_name text,
  entry_date date,
  amount_paise bigint,
  direction text check (direction in ('debit','credit','unknown')),  -- debit: party owes more (udhaar/purchase); credit: payment
  description text,
  confidence numeric(4,3) not null default 0,       -- 0..1
  flags text[] not null default '{}',               -- e.g. {'unreadable_amount','date_missing','possible_duplicate'}
  -- Reviewed / final values (set by the owner on the review screen)
  party_name_final text,
  party_id_final uuid,                              -- matched customer or supplier
  entry_date_final date,
  amount_paise_final bigint,
  direction_final text check (direction_final in ('debit','credit')),
  description_final text,
  status scan_entry_status not null default 'pending',
  duplicate_of_entry_id uuid references notebook_entries(id),
  imported_record_table text,
  imported_record_id uuid,
  reviewed_by_member_id uuid references shop_members(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on notebook_entries(scan_id);
create index on notebook_entries(shop_id, status);

-- ---------------------------------------------------------------------------
-- Audit log, approvals, notifications, sync
-- ---------------------------------------------------------------------------
create table audit_log (
  id bigserial primary key,
  shop_id uuid not null references shops(id) on delete cascade,
  actor_user_id uuid,
  actor_member_id uuid,
  table_name text not null,
  record_id text not null,
  action text not null,                              -- insert | update | delete | rpc:<name>
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);
create index on audit_log(shop_id, created_at desc);

create table approval_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  requested_by_member_id uuid not null references shop_members(id),
  kind text not null,                                -- refund | discount | expense | stock_adjustment
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by_member_id uuid references shop_members(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on approval_requests(shop_id, status);

create table notifications_outbox (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  channel text not null default 'whatsapp',
  recipient text not null,
  template text not null,                            -- daily_report | cash_discrepancy | low_stock | payment_reminder | shift_closed
  payload jsonb not null,
  status notification_status not null default 'queued',
  provider text,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on notifications_outbox(shop_id, status);

-- Records every client write received, for idempotent sync.
create table sync_receipts (
  shop_id uuid not null references shops(id) on delete cascade,
  op_id uuid not null,                               -- client-side outbox op id
  table_name text not null,
  record_id uuid not null,
  received_at timestamptz not null default now(),
  primary key (shop_id, op_id)
);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, caches, audit
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['shops','shop_members','categories','products','customers','suppliers','shifts','sales','payments','purchases','expenses','stock_counts','notebook_scans','notebook_entries','approval_requests'])
  loop
    execute format('create trigger %I_set_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- Stock cache
create or replace function apply_stock_movement() returns trigger language plpgsql as $$
begin
  update products set stock_qty = stock_qty + new.qty_delta where id = new.product_id;
  return new;
end $$;
create trigger stock_movements_apply after insert on stock_movements for each row execute function apply_stock_movement();

-- Customer balance cache
create or replace function apply_customer_ledger_entry() returns trigger language plpgsql as $$
begin
  update customers set balance_paise = balance_paise + new.amount_paise where id = new.customer_id;
  return new;
end $$;
create trigger customer_ledger_apply after insert on customer_ledger_entries for each row execute function apply_customer_ledger_entry();

-- Supplier balance cache
create or replace function apply_supplier_ledger_entry() returns trigger language plpgsql as $$
begin
  update suppliers set balance_paise = balance_paise + new.amount_paise where id = new.supplier_id;
  return new;
end $$;
create trigger supplier_ledger_apply after insert on supplier_ledger_entries for each row execute function apply_supplier_ledger_entry();

-- Immutability guard: financial event rows cannot be updated or deleted (except whitelisted columns via RPC)
create or replace function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception 'Table % is append-only. Create a reversal/adjustment record instead.', tg_table_name
    using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['sale_items','refunds','customer_ledger_entries','supplier_ledger_entries','stock_movements','purchase_items','stock_count_items','audit_log','sync_receipts'])
  loop
    execute format('create trigger %I_immutable before update or delete on %I for each row execute function forbid_change()', t, t);
  end loop;
end $$;

-- sales / payments / expenses / purchases allow only status-type transitions (enforced in RPC + here)
create or replace function guard_sale_update() returns trigger language plpgsql as $$
begin
  if old.id <> new.id or old.shop_id <> new.shop_id or old.member_id <> new.member_id
     or old.total_paise <> new.total_paise or old.subtotal_paise <> new.subtotal_paise
     or old.discount_paise <> new.discount_paise or old.client_created_at <> new.client_created_at then
    raise exception 'Sale financial fields are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger sales_guard before update on sales for each row execute function guard_sale_update();
create trigger sales_no_delete before delete on sales for each row execute function forbid_change();

create or replace function guard_payment_update() returns trigger language plpgsql as $$
begin
  if old.amount_paise <> new.amount_paise or old.method <> new.method or old.member_id <> new.member_id
     or old.shop_id <> new.shop_id or old.client_created_at <> new.client_created_at then
    raise exception 'Payment financial fields are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger payments_guard before update on payments for each row execute function guard_payment_update();
create trigger payments_no_delete before delete on payments for each row execute function forbid_change();

create or replace function guard_expense_update() returns trigger language plpgsql as $$
begin
  if old.amount_paise <> new.amount_paise or old.member_id <> new.member_id or old.shop_id <> new.shop_id
     or old.paid_method <> new.paid_method or old.expense_date <> new.expense_date then
    raise exception 'Expense financial fields are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger expenses_guard before update on expenses for each row execute function guard_expense_update();
create trigger expenses_no_delete before delete on expenses for each row execute function forbid_change();
create trigger purchases_no_delete before delete on purchases for each row execute function forbid_change();

-- Generic audit trigger
create or replace function audit_row_change() returns trigger language plpgsql security definer as $$
declare
  v_shop uuid;
  v_member uuid;
begin
  v_shop := coalesce((case when tg_op = 'DELETE' then old.shop_id else new.shop_id end), null);
  select id into v_member from shop_members where user_id = auth.uid() limit 1;
  insert into audit_log(shop_id, actor_user_id, actor_member_id, table_name, record_id, action, old_value, new_value)
  values (
    v_shop, auth.uid(), v_member, tg_table_name,
    (case when tg_op = 'DELETE' then old.id else new.id end)::text,
    lower(tg_op),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  for t in select unnest(array['shop_members','products','customers','suppliers','sales','payments','refunds','expenses','purchases','stock_movements','shifts','notebook_entries','approval_requests'])
  loop
    execute format('create trigger %I_audit after insert or update or delete on %I for each row execute function audit_row_change()', t, t);
  end loop;
end $$;
