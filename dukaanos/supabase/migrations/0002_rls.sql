-- DukaanOS V1 — Row Level Security
-- Every authenticated user maps to exactly one shop_members row (user_id unique).
-- Owners/admins manage master data; employees create append-only events only.
-- Financial events are inserted through RPCs (0003_rpc.sql) which validate permissions again.

create or replace function current_member() returns shop_members
language sql stable security definer set search_path = public as $$
  select * from shop_members where user_id = auth.uid() and is_active limit 1
$$;

create or replace function current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from shop_members where user_id = auth.uid() and is_active limit 1
$$;

create or replace function current_shop_id() returns uuid
language sql stable security definer set search_path = public as $$
  select shop_id from shop_members where user_id = auth.uid() and is_active limit 1
$$;

create or replace function current_role_name() returns member_role
language sql stable security definer set search_path = public as $$
  select role from shop_members where user_id = auth.uid() and is_active limit 1
$$;

create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('owner','admin') from shop_members where user_id = auth.uid() and is_active limit 1), false)
$$;

create or replace function has_permission(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('owner','admin') or coalesce((permissions ->> p_key)::boolean, false)
       from shop_members where user_id = auth.uid() and is_active limit 1),
    false)
$$;

-- ---------------------------------------------------------------------------
alter table shops enable row level security;
alter table shop_members enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table customers enable row level security;
alter table suppliers enable row level security;
alter table shifts enable row level security;
alter table sales enable row level security;
alter table sale_items enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table customer_ledger_entries enable row level security;
alter table purchases enable row level security;
alter table purchase_items enable row level security;
alter table supplier_ledger_entries enable row level security;
alter table expense_categories enable row level security;
alter table expenses enable row level security;
alter table stock_movements enable row level security;
alter table stock_counts enable row level security;
alter table stock_count_items enable row level security;
alter table notebook_scans enable row level security;
alter table notebook_entries enable row level security;
alter table audit_log enable row level security;
alter table approval_requests enable row level security;
alter table notifications_outbox enable row level security;
alter table sync_receipts enable row level security;

-- Shops: members read; owner updates. Creation happens through create_shop() RPC.
create policy shops_select on shops for select using (id = current_shop_id());
create policy shops_update on shops for update using (owner_user_id = auth.uid() or (id = current_shop_id() and is_manager()));

-- Members: everyone in the shop can see colleagues (names only matter); managers manage.
create policy members_select on shop_members for select using (shop_id = current_shop_id());
create policy members_insert on shop_members for insert with check (shop_id = current_shop_id() and is_manager());
create policy members_update on shop_members for update using (shop_id = current_shop_id() and is_manager());
-- Nobody deletes members via API; deactivate instead.

-- Master data
create policy categories_select on categories for select using (shop_id = current_shop_id());
create policy categories_write on categories for all using (shop_id = current_shop_id() and is_manager()) with check (shop_id = current_shop_id() and is_manager());

create policy products_select on products for select using (shop_id = current_shop_id());
create policy products_insert on products for insert with check (shop_id = current_shop_id() and is_manager());
create policy products_update on products for update using (shop_id = current_shop_id() and is_manager());
-- No product deletes: deactivate (keeps history intact)

create policy customers_select on customers for select using (shop_id = current_shop_id());
create policy customers_insert on customers for insert with check (shop_id = current_shop_id());   -- employees may add a new khata customer
create policy customers_update on customers for update using (shop_id = current_shop_id() and is_manager());

create policy suppliers_select on suppliers for select using (shop_id = current_shop_id());
create policy suppliers_insert on suppliers for insert with check (shop_id = current_shop_id() and has_permission('can_receive_stock'));
create policy suppliers_update on suppliers for update using (shop_id = current_shop_id() and is_manager());

create policy expense_categories_select on expense_categories for select using (shop_id = current_shop_id());
create policy expense_categories_write on expense_categories for all using (shop_id = current_shop_id() and is_manager()) with check (shop_id = current_shop_id() and is_manager());

-- Shifts: employees see their own + managers see all. Writes via RPC only (security definer).
create policy shifts_select on shifts for select using (shop_id = current_shop_id() and (is_manager() or member_id = current_member_id()));

-- Financial events: read within shop. Employees see their own; managers see all.
create policy sales_select on sales for select using (shop_id = current_shop_id() and (is_manager() or member_id = current_member_id()));
create policy sale_items_select on sale_items for select using (shop_id = current_shop_id());
create policy payments_select on payments for select using (shop_id = current_shop_id() and (is_manager() or member_id = current_member_id()));
create policy refunds_select on refunds for select using (shop_id = current_shop_id() and (is_manager() or member_id = current_member_id()));
create policy expenses_select on expenses for select using (shop_id = current_shop_id() and (is_manager() or member_id = current_member_id()));
create policy customer_ledger_select on customer_ledger_entries for select using (shop_id = current_shop_id());
create policy supplier_ledger_select on supplier_ledger_entries for select using (shop_id = current_shop_id() and (is_manager() or has_permission('can_receive_stock')));
create policy purchases_select on purchases for select using (shop_id = current_shop_id() and (is_manager() or has_permission('can_receive_stock')));
create policy purchase_items_select on purchase_items for select using (shop_id = current_shop_id() and (is_manager() or has_permission('can_receive_stock')));
create policy stock_movements_select on stock_movements for select using (shop_id = current_shop_id());
create policy stock_counts_select on stock_counts for select using (shop_id = current_shop_id());
create policy stock_count_items_select on stock_count_items for select using (shop_id = current_shop_id());

-- Direct inserts are intentionally NOT allowed on financial tables: the RPCs in 0003 are
-- security definer and perform validation + permission checks. This keeps a single write path.

-- Notebook scanner: managers only
create policy scans_all on notebook_scans for all using (shop_id = current_shop_id() and is_manager()) with check (shop_id = current_shop_id() and is_manager());
create policy scan_entries_select on notebook_entries for select using (shop_id = current_shop_id() and is_manager());
create policy scan_entries_insert on notebook_entries for insert with check (shop_id = current_shop_id() and is_manager());  -- manual rows added on review screen
create policy scan_entries_update on notebook_entries for update using (shop_id = current_shop_id() and is_manager());

-- Audit log: managers read only
create policy audit_select on audit_log for select using (shop_id = current_shop_id() and is_manager());

-- Approvals: requester + managers
create policy approvals_select on approval_requests for select using (shop_id = current_shop_id() and (is_manager() or requested_by_member_id = current_member_id()));
create policy approvals_insert on approval_requests for insert with check (shop_id = current_shop_id() and requested_by_member_id = current_member_id());
create policy approvals_update on approval_requests for update using (shop_id = current_shop_id() and is_manager());

-- Notifications outbox: managers read; written by server functions
create policy notifications_select on notifications_outbox for select using (shop_id = current_shop_id() and is_manager());

create policy sync_receipts_select on sync_receipts for select using (shop_id = current_shop_id());

-- Revoke direct table privileges that RLS would otherwise expose for insert/delete paths we don't want
revoke delete on all tables in schema public from authenticated, anon;
