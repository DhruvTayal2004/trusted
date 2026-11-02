-- DukaanOS V1 — Transactional RPCs (single write path for financial events)
-- All RPCs are SECURITY DEFINER, re-check permissions, and are IDEMPOTENT on client-generated ids:
-- replaying the same payload returns the already-stored record instead of creating a duplicate.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function _require_member() returns shop_members
language plpgsql stable security definer set search_path = public as $$
declare m shop_members;
begin
  select * into m from shop_members where user_id = auth.uid() and is_active limit 1;
  if m.id is null then
    raise exception 'Not a member of any shop' using errcode = '42501';
  end if;
  return m;
end $$;

create or replace function _require_manager() returns shop_members
language plpgsql stable security definer set search_path = public as $$
declare m shop_members;
begin
  m := _require_member();
  if m.role not in ('owner','admin') then
    raise exception 'Owner or admin role required' using errcode = '42501';
  end if;
  return m;
end $$;

create or replace function _member_has(m shop_members, p_key text) returns boolean
language sql immutable as $$
  select m.role in ('owner','admin') or coalesce((m.permissions ->> p_key)::boolean, false)
$$;

create or replace function _shop_today(p_shop_id uuid) returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from shops where id = p_shop_id), 'Asia/Kolkata'))::date
$$;

create or replace function _open_shift_id(p_member_id uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from shifts where member_id = p_member_id and status = 'open' limit 1
$$;

create or replace function _audit(p_shop uuid, p_member uuid, p_table text, p_record text, p_action text, p_old jsonb, p_new jsonb, p_reason text)
returns void language sql security definer set search_path = public as $$
  insert into audit_log(shop_id, actor_user_id, actor_member_id, table_name, record_id, action, old_value, new_value, reason)
  values (p_shop, auth.uid(), p_member, p_table, p_record, p_action, p_old, p_new, p_reason)
$$;

-- ---------------------------------------------------------------------------
-- Shop creation & membership
-- ---------------------------------------------------------------------------
create or replace function create_shop(p_name text, p_owner_name text, p_phone text default null)
returns shops language plpgsql security definer set search_path = public as $$
declare s shops;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if exists (select 1 from shop_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a shop' using errcode = 'P0001';
  end if;
  insert into shops(name, owner_user_id, phone, settings)
  values (p_name, auth.uid(), p_phone, jsonb_build_object('shop_code', upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6))))
  returning * into s;
  insert into shop_members(shop_id, user_id, role, display_name, phone,
    permissions)
  values (s.id, auth.uid(), 'owner', p_owner_name, p_phone,
    '{"can_refund":true,"can_discount":true,"max_discount_pct":100,"can_receive_stock":true,"can_adjust_stock":true,"can_record_expense":true,"can_view_purchase_price":true}'::jsonb);
  insert into expense_categories(shop_id, name) values
    (s.id, 'Rent'), (s.id, 'Electricity'), (s.id, 'Transport'), (s.id, 'Tea/Chai'), (s.id, 'Salary'), (s.id, 'Packaging'), (s.id, 'Other');
  insert into categories(shop_id, name, sort_order) values
    (s.id, 'Grains & Flour', 1), (s.id, 'Pulses', 2), (s.id, 'Oil & Ghee', 3), (s.id, 'Spices', 4),
    (s.id, 'Dairy', 5), (s.id, 'Snacks', 6), (s.id, 'Beverages', 7), (s.id, 'Household', 8), (s.id, 'Other', 9);
  return s;
end $$;

-- Called by the `pin-login` edge function (service role) and by managers to set an employee PIN.
create or replace function set_member_pin(p_member_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public as $$
declare m shop_members; target shop_members;
begin
  m := _require_manager();
  select * into target from shop_members where id = p_member_id and shop_id = m.shop_id;
  if target.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if p_pin !~ '^[0-9]{4,6}$' then raise exception 'PIN must be 4-6 digits' using errcode = 'P0001'; end if;
  update shop_members set pin_hash = crypt(p_pin, gen_salt('bf', 10)), pin_failed_attempts = 0, pin_locked_until = null
  where id = p_member_id;
  perform _audit(m.shop_id, m.id, 'shop_members', p_member_id::text, 'rpc:set_member_pin', null, null, 'PIN changed');
end $$;

-- Service-role only: resolve a shop code to its name + active PIN members (for the employee login screen).
create or replace function lookup_shop_by_code(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sh shops;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into sh from shops where upper(settings->>'shop_code') = upper(trim(p_code)) limit 1;
  if sh.id is null then return null; end if;
  return jsonb_build_object('shop_id', sh.id, 'shop_name', sh.name,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name) order by display_name), '[]'::jsonb)
                from shop_members where shop_id = sh.id and is_active and pin_hash is not null));
end $$;

-- Service-role only: verify PIN. Returns member row on success, raises on failure. Used by edge function.
create or replace function verify_member_pin(p_shop_id uuid, p_member_id uuid, p_pin text)
returns shop_members language plpgsql security definer set search_path = public as $$
declare m shop_members;
begin
  if coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into m from shop_members where id = p_member_id and shop_id = p_shop_id and is_active;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if m.pin_locked_until is not null and m.pin_locked_until > now() then
    raise exception 'PIN locked. Try again later.' using errcode = 'P0001';
  end if;
  if m.pin_hash is null or m.pin_hash <> crypt(p_pin, m.pin_hash) then
    update shop_members set pin_failed_attempts = pin_failed_attempts + 1,
      pin_locked_until = case when pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes' else null end
    where id = m.id;
    raise exception 'Incorrect PIN' using errcode = 'P0001';
  end if;
  update shop_members set pin_failed_attempts = 0, pin_locked_until = null where id = m.id;
  return m;
end $$;

-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
create or replace function open_shift(p_id uuid, p_opening_cash_paise bigint, p_client_created_at timestamptz default now())
returns shifts language plpgsql security definer set search_path = public as $$
declare m shop_members; s shifts;
begin
  m := _require_member();
  select * into s from shifts where id = p_id;
  if s.id is not null then return s; end if;                       -- idempotent replay
  select * into s from shifts where member_id = m.id and status = 'open';
  if s.id is not null then return s; end if;                       -- already open: return it
  if p_opening_cash_paise < 0 then raise exception 'Opening cash cannot be negative'; end if;
  insert into shifts(id, shop_id, member_id, opening_cash_paise, opened_at)
  values (p_id, m.shop_id, m.id, p_opening_cash_paise, p_client_created_at) returning * into s;
  return s;
end $$;

-- Deterministic expected-cash computation for a shift. Pure SQL; used by close_shift and the AI assistant.
create or replace function shift_cash_summary(p_shift_id uuid)
returns table (
  opening_cash_paise bigint, cash_sales_paise bigint, cash_received_paise bigint, cash_refunds_paise bigint,
  cash_expenses_paise bigint, cash_paid_out_paise bigint, expected_cash_paise bigint,
  upi_sales_paise bigint, upi_received_paise bigint, upi_verified_paise bigint, credit_sales_paise bigint,
  sales_count bigint, total_sales_paise bigint
) language sql stable security definer set search_path = public as $$
  with s as (select * from shifts where id = p_shift_id and shop_id = current_shop_id()),
  p as (select * from payments where shift_id = p_shift_id and status <> 'failed'),
  agg as (
    select
      (select opening_cash_paise from s) as opening,
      coalesce((select sum(amount_paise) from p where method = 'cash' and sale_id is not null), 0) as cash_sales,
      coalesce((select sum(amount_paise) from p where method = 'cash' and sale_id is null), 0) as cash_received,
      coalesce((select sum(amount_paise) from refunds where shift_id = p_shift_id and method = 'cash'), 0) as cash_refunds,
      coalesce((select sum(amount_paise) from expenses where shift_id = p_shift_id and paid_method = 'cash' and status <> 'rejected'), 0) as cash_expenses,
      coalesce((select sum(-amount_paise) from supplier_ledger_entries where shift_id = p_shift_id and entry_type = 'payment' and payment_method = 'cash'), 0) as cash_paid_out,
      coalesce((select sum(amount_paise) from p where method = 'upi' and sale_id is not null), 0) as upi_sales,
      coalesce((select sum(amount_paise) from p where method = 'upi' and sale_id is null), 0) as upi_received,
      coalesce((select sum(amount_paise) from p where method = 'upi' and status = 'verified'), 0) as upi_verified,
      coalesce((select sum(amount_paise) from p where method = 'credit'), 0) as credit_sales,
      (select count(*) from sales where shift_id = p_shift_id and status <> 'reversed') as sales_count,
      coalesce((select sum(total_paise) from sales where shift_id = p_shift_id and status <> 'reversed'), 0) as total_sales
  )
  select opening, cash_sales, cash_received, cash_refunds, cash_expenses, cash_paid_out,
         opening + cash_sales + cash_received - cash_refunds - cash_expenses - cash_paid_out,
         upi_sales, upi_received, upi_verified, credit_sales, sales_count, total_sales
  from agg
$$;

create or replace function close_shift(p_shift_id uuid, p_counted_cash_paise bigint, p_notes text default null, p_handover_to uuid default null)
returns shifts language plpgsql security definer set search_path = public as $$
declare m shop_members; s shifts; c record;
begin
  m := _require_member();
  select * into s from shifts where id = p_shift_id and shop_id = m.shop_id;
  if s.id is null then raise exception 'Shift not found' using errcode = 'P0002'; end if;
  if s.status = 'closed' then return s; end if;                     -- idempotent
  if s.member_id <> m.id and m.role not in ('owner','admin') then
    raise exception 'You can only close your own shift' using errcode = '42501';
  end if;
  if p_counted_cash_paise < 0 then raise exception 'Counted cash cannot be negative'; end if;
  select * into c from shift_cash_summary(p_shift_id);
  update shifts set
    status = 'closed', closed_at = now(),
    expected_cash_paise = c.expected_cash_paise,
    counted_cash_paise = p_counted_cash_paise,
    cash_difference_paise = p_counted_cash_paise - c.expected_cash_paise,
    cash_sales_paise = c.cash_sales_paise, cash_received_paise = c.cash_received_paise,
    cash_refunds_paise = c.cash_refunds_paise, cash_expenses_paise = c.cash_expenses_paise,
    cash_paid_out_paise = c.cash_paid_out_paise, upi_sales_paise = c.upi_sales_paise,
    upi_received_paise = c.upi_received_paise, upi_verified_paise = c.upi_verified_paise,
    credit_sales_paise = c.credit_sales_paise,
    closing_notes = p_notes, handover_to_member_id = p_handover_to
  where id = p_shift_id returning * into s;

  if abs(s.cash_difference_paise) >= coalesce((select (settings->>'cash_alert_threshold_paise')::bigint from shops where id = m.shop_id), 5000) then
    insert into notifications_outbox(shop_id, recipient, template, payload)
    select m.shop_id, coalesce(sh.phone, ''), 'cash_discrepancy',
      jsonb_build_object('shift_id', s.id, 'member', m.display_name, 'expected_paise', s.expected_cash_paise,
                         'counted_paise', s.counted_cash_paise, 'difference_paise', s.cash_difference_paise)
    from shops sh where sh.id = m.shop_id;
  end if;
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- Sales
-- ---------------------------------------------------------------------------
-- payload: { id, client_created_at, customer_id?, source?, note?, discount_reason?,
--            subtotal_paise, discount_paise, total_paise,
--            items: [{id, product_id?, description, unit, qty, unit_price_paise, line_total_paise}],
--            payments: [{id, method, amount_paise, upi_reference?, status?}] }
create or replace function post_sale(p jsonb)
returns sales language plpgsql security definer set search_path = public as $$
declare
  m shop_members; s sales; it jsonb; pay jsonb; prod products;
  v_id uuid := (p->>'id')::uuid;
  v_items_total bigint := 0; v_pay_total bigint := 0; v_credit_total bigint := 0;
  v_subtotal bigint := (p->>'subtotal_paise')::bigint;
  v_discount bigint := coalesce((p->>'discount_paise')::bigint, 0);
  v_total bigint := (p->>'total_paise')::bigint;
  v_customer uuid := nullif(p->>'customer_id','')::uuid;
  v_shift uuid; v_max_pct numeric;
begin
  m := _require_member();
  if v_id is null then raise exception 'sale id required'; end if;
  select * into s from sales where id = v_id;
  if s.id is not null then return s; end if;                        -- idempotent replay

  if jsonb_array_length(coalesce(p->'items','[]'::jsonb)) = 0 then raise exception 'Sale needs at least one item'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if (it->>'qty')::numeric <= 0 then raise exception 'Quantity must be positive'; end if;
    v_items_total := v_items_total + (it->>'line_total_paise')::bigint;
  end loop;
  if v_items_total <> v_subtotal then raise exception 'Subtotal % does not match items %', v_subtotal, v_items_total; end if;
  if v_subtotal - v_discount <> v_total then raise exception 'Total does not equal subtotal - discount'; end if;
  if v_discount > 0 then
    if not _member_has(m, 'can_discount') then raise exception 'Discount not permitted for this employee' using errcode = '42501'; end if;
    v_max_pct := coalesce((m.permissions->>'max_discount_pct')::numeric, 0);
    if m.role = 'employee' and v_subtotal > 0 and (v_discount::numeric * 100 / v_subtotal) > v_max_pct then
      raise exception 'Discount exceeds allowed % %%', v_max_pct using errcode = '42501';
    end if;
  end if;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    v_pay_total := v_pay_total + (pay->>'amount_paise')::bigint;
    if pay->>'method' = 'credit' then v_credit_total := v_credit_total + (pay->>'amount_paise')::bigint; end if;
  end loop;
  if v_pay_total <> v_total then raise exception 'Payments % do not cover total %', v_pay_total, v_total; end if;
  if v_credit_total > 0 and v_customer is null then raise exception 'Credit sale requires a customer'; end if;
  if v_customer is not null and not exists (select 1 from customers where id = v_customer and shop_id = m.shop_id) then
    raise exception 'Customer not found' using errcode = 'P0002';
  end if;

  v_shift := _open_shift_id(m.id);

  insert into sales(id, shop_id, member_id, shift_id, customer_id, subtotal_paise, discount_paise, total_paise,
                    discount_reason, note, source, client_created_at)
  values (v_id, m.shop_id, m.id, v_shift, v_customer, v_subtotal, v_discount, v_total,
          p->>'discount_reason', p->>'note', coalesce(p->>'source','manual'),
          coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into s;

  for it in select * from jsonb_array_elements(p->'items') loop
    insert into sale_items(id, sale_id, shop_id, product_id, description, unit, qty, unit_price_paise, line_total_paise)
    values ((it->>'id')::uuid, s.id, m.shop_id, nullif(it->>'product_id','')::uuid, it->>'description',
            (it->>'unit')::product_unit, (it->>'qty')::numeric, (it->>'unit_price_paise')::bigint, (it->>'line_total_paise')::bigint);
    if nullif(it->>'product_id','') is not null then
      select * into prod from products where id = (it->>'product_id')::uuid and shop_id = m.shop_id;
      if prod.id is null then raise exception 'Product % not found', it->>'product_id' using errcode = 'P0002'; end if;
      insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, sale_id, sale_item_id, client_created_at)
      values (gen_random_uuid(), m.shop_id, prod.id, m.id, 'sale', -((it->>'qty')::numeric), s.id, (it->>'id')::uuid, s.client_created_at);
    end if;
  end loop;

  for pay in select * from jsonb_array_elements(coalesce(p->'payments','[]'::jsonb)) loop
    insert into payments(id, shop_id, sale_id, customer_id, member_id, shift_id, method, status, amount_paise, upi_reference, client_created_at)
    values ((pay->>'id')::uuid, m.shop_id, s.id, v_customer, m.id, v_shift, (pay->>'method')::payment_method,
            (case when pay->>'method' = 'upi' then coalesce((pay->>'status')::payment_status, 'pending_verification'::payment_status) else 'received'::payment_status end),
            (pay->>'amount_paise')::bigint, pay->>'upi_reference', s.client_created_at);
    if pay->>'method' = 'credit' then
      insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, sale_id, payment_id, entry_date, client_created_at)
      values (gen_random_uuid(), m.shop_id, v_customer, m.id, 'credit_sale', (pay->>'amount_paise')::bigint, s.id, (pay->>'id')::uuid,
              (s.client_created_at at time zone (select timezone from shops where id = m.shop_id))::date, s.client_created_at);
    end if;
  end loop;

  if p->>'op_id' is not null then
    insert into sync_receipts(shop_id, op_id, table_name, record_id) values (m.shop_id, (p->>'op_id')::uuid, 'sales', s.id) on conflict do nothing;
  end if;
  return s;
end $$;

-- Mark a UPI payment verified/failed (owner/admin, or the employee who recorded it within their open shift)
create or replace function set_upi_payment_status(p_payment_id uuid, p_status payment_status, p_reference text default null)
returns payments language plpgsql security definer set search_path = public as $$
declare m shop_members; pm payments;
begin
  m := _require_member();
  select * into pm from payments where id = p_payment_id and shop_id = m.shop_id and method = 'upi';
  if pm.id is null then raise exception 'UPI payment not found' using errcode = 'P0002'; end if;
  if p_status not in ('verified','failed','pending_verification') then raise exception 'Invalid status'; end if;
  if m.role = 'employee' and pm.member_id <> m.id then raise exception 'Not your payment' using errcode = '42501'; end if;
  update payments set status = p_status, upi_reference = coalesce(p_reference, upi_reference) where id = p_payment_id returning * into pm;
  return pm;
end $$;

-- Refund (reversal event). Requires can_refund or manager.
create or replace function post_refund(p jsonb)
returns refunds language plpgsql security definer set search_path = public as $$
declare m shop_members; r refunds; s sales; v_id uuid := (p->>'id')::uuid; v_amount bigint := (p->>'amount_paise')::bigint; already bigint; it record;
begin
  m := _require_member();
  select * into r from refunds where id = v_id; if r.id is not null then return r; end if;
  if not _member_has(m, 'can_refund') then raise exception 'Refund not permitted' using errcode = '42501'; end if;
  select * into s from sales where id = (p->>'sale_id')::uuid and shop_id = m.shop_id;
  if s.id is null then raise exception 'Sale not found' using errcode = 'P0002'; end if;
  select coalesce(sum(amount_paise),0) into already from refunds where sale_id = s.id;
  if v_amount <= 0 or already + v_amount > s.total_paise then raise exception 'Refund exceeds sale total'; end if;
  insert into refunds(id, shop_id, sale_id, member_id, shift_id, method, amount_paise, reason, restock, client_created_at)
  values (v_id, m.shop_id, s.id, m.id, _open_shift_id(m.id), (p->>'method')::payment_method, v_amount, p->>'reason',
          coalesce((p->>'restock')::boolean, false), coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into r;
  if p->>'method' = 'credit' and s.customer_id is not null then
    insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, sale_id, entry_date, note, client_created_at)
    values (gen_random_uuid(), m.shop_id, s.customer_id, m.id, 'reversal', -v_amount, s.id, _shop_today(m.shop_id), 'Refund: ' || coalesce(p->>'reason',''), r.client_created_at);
  end if;
  if r.restock and already + v_amount = s.total_paise then
    for it in select * from sale_items where sale_id = s.id and product_id is not null loop
      insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, sale_id, refund_id, reason, client_created_at)
      values (gen_random_uuid(), m.shop_id, it.product_id, m.id, 'sale_reversal', it.qty, s.id, r.id, 'Refund restock', r.client_created_at);
    end loop;
  end if;
  update sales set status = (case when already + v_amount = s.total_paise then 'reversed' else 'partially_refunded' end)::sale_status where id = s.id;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Khata (customer credit)
-- ---------------------------------------------------------------------------
-- Record money received from a customer against their balance.
create or replace function post_khata_payment(p jsonb)
returns payments language plpgsql security definer set search_path = public as $$
declare m shop_members; pm payments; v_id uuid := (p->>'id')::uuid; v_customer uuid := (p->>'customer_id')::uuid; v_amount bigint := (p->>'amount_paise')::bigint; v_shift uuid; v_at timestamptz;
begin
  m := _require_member();
  select * into pm from payments where id = v_id; if pm.id is not null then return pm; end if;
  if v_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if not exists (select 1 from customers where id = v_customer and shop_id = m.shop_id) then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  if p->>'method' not in ('cash','upi') then raise exception 'Khata payment must be cash or upi'; end if;
  v_shift := _open_shift_id(m.id);
  v_at := coalesce((p->>'client_created_at')::timestamptz, now());
  insert into payments(id, shop_id, sale_id, customer_id, member_id, shift_id, method, status, amount_paise, upi_reference, note, client_created_at)
  values (v_id, m.shop_id, null, v_customer, m.id, v_shift, (p->>'method')::payment_method,
          (case when p->>'method' = 'upi' then 'pending_verification' else 'received' end)::payment_status,
          v_amount, p->>'upi_reference', p->>'note', v_at) returning * into pm;
  insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, payment_id, entry_date, note, client_created_at)
  values (gen_random_uuid(), m.shop_id, v_customer, m.id, 'payment', -v_amount, pm.id,
          coalesce((p->>'entry_date')::date, (v_at at time zone (select timezone from shops where id = m.shop_id))::date), p->>'note', v_at);
  if p->>'op_id' is not null then
    insert into sync_receipts(shop_id, op_id, table_name, record_id) values (m.shop_id, (p->>'op_id')::uuid, 'payments', pm.id) on conflict do nothing;
  end if;
  return pm;
end $$;

-- Manual khata entry: opening balance (manager) or adjustment with reason (manager), or an "udhaar" without a sale (employee)
create or replace function post_khata_entry(p jsonb)
returns customer_ledger_entries language plpgsql security definer set search_path = public as $$
declare m shop_members; e customer_ledger_entries; v_id uuid := (p->>'id')::uuid; v_type ledger_entry_type := (p->>'entry_type')::ledger_entry_type;
begin
  m := _require_member();
  select * into e from customer_ledger_entries where id = v_id; if e.id is not null then return e; end if;
  if v_type in ('opening_balance','adjustment') and m.role = 'employee' then raise exception 'Only owner/admin can post % entries', v_type using errcode = '42501'; end if;
  if v_type = 'adjustment' and coalesce(p->>'note','') = '' then raise exception 'Adjustment needs a reason'; end if;
  if v_type not in ('opening_balance','adjustment','credit_sale') then raise exception 'Unsupported entry type via this RPC'; end if;
  if not exists (select 1 from customers where id = (p->>'customer_id')::uuid and shop_id = m.shop_id) then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, entry_date, note, client_created_at)
  values (v_id, m.shop_id, (p->>'customer_id')::uuid, m.id, v_type, (p->>'amount_paise')::bigint,
          coalesce((p->>'entry_date')::date, _shop_today(m.shop_id)), p->>'note', coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create or replace function post_expense(p jsonb)
returns expenses language plpgsql security definer set search_path = public as $$
declare m shop_members; e expenses; cat expense_categories; v_id uuid := (p->>'id')::uuid; v_status expense_status;
begin
  m := _require_member();
  select * into e from expenses where id = v_id; if e.id is not null then return e; end if;
  if not _member_has(m, 'can_record_expense') then raise exception 'Expense recording not permitted' using errcode = '42501'; end if;
  if (p->>'amount_paise')::bigint <= 0 then raise exception 'Amount must be positive'; end if;
  select * into cat from expense_categories where id = nullif(p->>'category_id','')::uuid and shop_id = m.shop_id;
  v_status := case when m.role = 'employee' and coalesce(cat.requires_approval, false) then 'pending_approval' else 'recorded' end;
  insert into expenses(id, shop_id, member_id, shift_id, category_id, category_name, amount_paise, paid_method, expense_date, note, receipt_image_path, status, client_created_at)
  values (v_id, m.shop_id, m.id, _open_shift_id(m.id), cat.id, coalesce(cat.name, p->>'category_name', 'Other'),
          (p->>'amount_paise')::bigint, coalesce((p->>'paid_method')::payment_method, 'cash'),
          coalesce((p->>'expense_date')::date, _shop_today(m.shop_id)), p->>'note', p->>'receipt_image_path', v_status,
          coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into e;
  return e;
end $$;

create or replace function decide_expense(p_expense_id uuid, p_approve boolean, p_note text default null)
returns expenses language plpgsql security definer set search_path = public as $$
declare m shop_members; e expenses;
begin
  m := _require_manager();
  update expenses set status = (case when p_approve then 'approved' else 'rejected' end)::expense_status,
    approved_by_member_id = m.id, approved_at = now(), note = coalesce(note,'') || case when p_note is null then '' else ' | ' || p_note end
  where id = p_expense_id and shop_id = m.shop_id returning * into e;
  if e.id is null then raise exception 'Expense not found' using errcode = 'P0002'; end if;
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- Purchases & supplier ledger
-- ---------------------------------------------------------------------------
-- payload: { id, supplier_id?, invoice_number?, invoice_date, invoice_image_path?, note?, client_created_at,
--            items:[{id, product_id?, description, unit, qty, unit_cost_paise, line_total_paise, update_purchase_price?:bool}],
--            paid_paise?, paid_method? }
create or replace function receive_purchase(p jsonb)
returns purchases language plpgsql security definer set search_path = public as $$
declare m shop_members; pu purchases; it jsonb; v_id uuid := (p->>'id')::uuid; v_total bigint := 0; v_paid bigint := coalesce((p->>'paid_paise')::bigint, 0); v_supplier uuid := nullif(p->>'supplier_id','')::uuid; v_at timestamptz;
begin
  m := _require_member();
  select * into pu from purchases where id = v_id; if pu.id is not null then return pu; end if;
  if not _member_has(m, 'can_receive_stock') then raise exception 'Receiving stock not permitted' using errcode = '42501'; end if;
  if v_supplier is not null and not exists (select 1 from suppliers where id = v_supplier and shop_id = m.shop_id) then raise exception 'Supplier not found' using errcode = 'P0002'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    v_total := v_total + (it->>'line_total_paise')::bigint;
  end loop;
  if v_total <= 0 then raise exception 'Purchase needs items'; end if;
  if v_paid < 0 or v_paid > v_total then raise exception 'Paid amount invalid'; end if;
  v_at := coalesce((p->>'client_created_at')::timestamptz, now());
  insert into purchases(id, shop_id, supplier_id, member_id, invoice_number, invoice_date, invoice_image_path, subtotal_paise, total_paise, paid_paise, paid_method, note, client_created_at)
  values (v_id, m.shop_id, v_supplier, m.id, p->>'invoice_number', coalesce((p->>'invoice_date')::date, _shop_today(m.shop_id)), p->>'invoice_image_path',
          v_total, v_total, v_paid, nullif(p->>'paid_method','')::payment_method, p->>'note', v_at) returning * into pu;
  for it in select * from jsonb_array_elements(p->'items') loop
    insert into purchase_items(id, purchase_id, shop_id, product_id, description, unit, qty, unit_cost_paise, line_total_paise)
    values ((it->>'id')::uuid, pu.id, m.shop_id, nullif(it->>'product_id','')::uuid, it->>'description', (it->>'unit')::product_unit,
            (it->>'qty')::numeric, (it->>'unit_cost_paise')::bigint, (it->>'line_total_paise')::bigint);
    if nullif(it->>'product_id','') is not null then
      insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, purchase_id, client_created_at)
      values (gen_random_uuid(), m.shop_id, (it->>'product_id')::uuid, m.id, 'purchase', (it->>'qty')::numeric, (it->>'unit_cost_paise')::bigint, pu.id, v_at);
      if coalesce((it->>'update_purchase_price')::boolean, true) then
        update products set purchase_price_paise = (it->>'unit_cost_paise')::bigint where id = (it->>'product_id')::uuid and shop_id = m.shop_id;
      end if;
    end if;
  end loop;
  if v_supplier is not null then
    insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, purchase_id, entry_date, note, client_created_at)
    values (gen_random_uuid(), m.shop_id, v_supplier, m.id, _open_shift_id(m.id), 'purchase', v_total, pu.id, pu.invoice_date, 'Invoice ' || coalesce(pu.invoice_number,''), v_at);
    if v_paid > 0 then
      insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, purchase_id, payment_method, entry_date, note, client_created_at)
      values (gen_random_uuid(), m.shop_id, v_supplier, m.id, _open_shift_id(m.id), 'payment', -v_paid, pu.id, coalesce(pu.paid_method,'cash'), pu.invoice_date, 'Paid on receipt', v_at);
    end if;
  end if;
  return pu;
end $$;

create or replace function post_supplier_payment(p jsonb)
returns supplier_ledger_entries language plpgsql security definer set search_path = public as $$
declare m shop_members; e supplier_ledger_entries; v_id uuid := (p->>'id')::uuid; v_amount bigint := (p->>'amount_paise')::bigint;
begin
  m := _require_member();
  select * into e from supplier_ledger_entries where id = v_id; if e.id is not null then return e; end if;
  if not _member_has(m, 'can_receive_stock') then raise exception 'Supplier payments not permitted' using errcode = '42501'; end if;
  if v_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if not exists (select 1 from suppliers where id = (p->>'supplier_id')::uuid and shop_id = m.shop_id) then raise exception 'Supplier not found' using errcode = 'P0002'; end if;
  insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, shift_id, entry_type, amount_paise, payment_method, entry_date, note, client_created_at)
  values (v_id, m.shop_id, (p->>'supplier_id')::uuid, m.id, _open_shift_id(m.id), 'payment', -v_amount, coalesce((p->>'method')::payment_method,'cash'),
          coalesce((p->>'entry_date')::date, _shop_today(m.shop_id)), p->>'note', coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into e;
  return e;
end $$;

create or replace function post_supplier_entry(p jsonb)
returns supplier_ledger_entries language plpgsql security definer set search_path = public as $$
declare m shop_members; e supplier_ledger_entries; v_id uuid := (p->>'id')::uuid;
begin
  m := _require_manager();
  select * into e from supplier_ledger_entries where id = v_id; if e.id is not null then return e; end if;
  if (p->>'entry_type') not in ('opening_balance','adjustment') then raise exception 'Unsupported entry type'; end if;
  insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, entry_type, amount_paise, entry_date, note, client_created_at)
  values (v_id, m.shop_id, (p->>'supplier_id')::uuid, m.id, (p->>'entry_type')::supplier_ledger_type, (p->>'amount_paise')::bigint,
          coalesce((p->>'entry_date')::date, _shop_today(m.shop_id)), p->>'note', coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into e;
  return e;
end $$;

-- ---------------------------------------------------------------------------
-- Inventory adjustments & counts
-- ---------------------------------------------------------------------------
create or replace function post_stock_adjustment(p jsonb)
returns stock_movements language plpgsql security definer set search_path = public as $$
declare m shop_members; mv stock_movements; v_id uuid := (p->>'id')::uuid; v_type stock_movement_type := (p->>'movement_type')::stock_movement_type;
begin
  m := _require_member();
  select * into mv from stock_movements where id = v_id; if mv.id is not null then return mv; end if;
  if v_type not in ('opening','damage','expiry','wastage','manual_adjustment','return_to_supplier') then raise exception 'Invalid adjustment type %', v_type; end if;
  if v_type = 'opening' and m.role = 'employee' then raise exception 'Only owner/admin can set opening stock' using errcode = '42501'; end if;
  if v_type <> 'opening' and not _member_has(m, 'can_adjust_stock') then raise exception 'Stock adjustment not permitted' using errcode = '42501'; end if;
  if coalesce(p->>'reason','') = '' and v_type <> 'opening' then raise exception 'Reason required'; end if;
  if not exists (select 1 from products where id = (p->>'product_id')::uuid and shop_id = m.shop_id) then raise exception 'Product not found' using errcode = 'P0002'; end if;
  insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, unit_cost_paise, reason, client_created_at)
  values (v_id, m.shop_id, (p->>'product_id')::uuid, m.id, v_type, (p->>'qty_delta')::numeric, nullif(p->>'unit_cost_paise','')::bigint, p->>'reason',
          coalesce((p->>'client_created_at')::timestamptz, now()))
  returning * into mv;
  return mv;
end $$;

-- Finalise a physical count: creates one count_adjustment movement per differing item.
-- payload: { id, note?, items:[{id, product_id, counted_qty}] }
create or replace function finalise_stock_count(p jsonb)
returns stock_counts language plpgsql security definer set search_path = public as $$
declare m shop_members; sc stock_counts; it jsonb; v_id uuid := (p->>'id')::uuid; v_sys numeric; v_counted numeric;
begin
  m := _require_member();
  select * into sc from stock_counts where id = v_id; if sc.id is not null and sc.status = 'finalised' then return sc; end if;
  if not _member_has(m, 'can_adjust_stock') then raise exception 'Stock counting not permitted' using errcode = '42501'; end if;
  if sc.id is null then
    insert into stock_counts(id, shop_id, member_id, note) values (v_id, m.shop_id, m.id, p->>'note') returning * into sc;
  end if;
  for it in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    select stock_qty into v_sys from products where id = (it->>'product_id')::uuid and shop_id = m.shop_id;
    if v_sys is null then raise exception 'Product % not found', it->>'product_id' using errcode = 'P0002'; end if;
    v_counted := (it->>'counted_qty')::numeric;
    insert into stock_count_items(id, stock_count_id, shop_id, product_id, system_qty, counted_qty, note)
    values ((it->>'id')::uuid, sc.id, m.shop_id, (it->>'product_id')::uuid, v_sys, v_counted, it->>'note')
    on conflict (id) do nothing;
    if v_counted <> v_sys then
      insert into stock_movements(id, shop_id, product_id, member_id, movement_type, qty_delta, stock_count_id, reason, client_created_at)
      values (gen_random_uuid(), m.shop_id, (it->>'product_id')::uuid, m.id, 'count_adjustment', v_counted - v_sys, sc.id,
              'Physical count: system ' || v_sys || ', counted ' || v_counted, now());
    end if;
  end loop;
  update stock_counts set status = 'finalised', finalised_at = now() where id = sc.id returning * into sc;
  return sc;
end $$;

-- ---------------------------------------------------------------------------
-- Notebook import
-- ---------------------------------------------------------------------------
-- Imports APPROVED notebook_entries of a scan batch into ledgers / expenses. Each entry imported once.
create or replace function import_notebook_entries(p_entry_ids uuid[])
returns table (entry_id uuid, imported_table text, imported_id uuid, error text)
language plpgsql security definer set search_path = public as $$
declare m shop_members; e notebook_entries; sc notebook_scans; v_new uuid; v_amt bigint; v_dir text;
begin
  m := _require_manager();
  for e in select * from notebook_entries where id = any(p_entry_ids) and shop_id = m.shop_id loop
    entry_id := e.id; imported_table := null; imported_id := null; error := null;
    begin
      if e.status = 'imported' then imported_table := e.imported_record_table; imported_id := e.imported_record_id; return next; continue; end if;
      if e.status <> 'approved' then error := 'Entry not approved'; return next; continue; end if;
      select * into sc from notebook_scans where id = e.scan_id;
      v_amt := coalesce(e.amount_paise_final, e.amount_paise);
      v_dir := coalesce(e.direction_final, e.direction);
      if v_amt is null or v_amt <= 0 then error := 'Amount missing'; return next; continue; end if;
      if coalesce(e.entry_date_final, e.entry_date) is null then error := 'Date missing'; return next; continue; end if;
      v_new := gen_random_uuid();
      if sc.kind = 'customer_khata' then
        if e.party_id_final is null then error := 'Customer not matched'; return next; continue; end if;
        if v_dir not in ('debit','credit') then error := 'Direction unknown'; return next; continue; end if;
        insert into customer_ledger_entries(id, shop_id, customer_id, member_id, entry_type, amount_paise, scan_entry_id, entry_date, note, client_created_at)
        values (v_new, m.shop_id, e.party_id_final, m.id, 'notebook_import', case when v_dir = 'debit' then v_amt else -v_amt end, e.id,
                coalesce(e.entry_date_final, e.entry_date), coalesce(e.description_final, e.description, 'Imported from notebook'), now());
        imported_table := 'customer_ledger_entries';
      elsif sc.kind = 'supplier_khata' or sc.kind = 'purchases' then
        if e.party_id_final is null then error := 'Supplier not matched'; return next; continue; end if;
        if v_dir not in ('debit','credit') then error := 'Direction unknown'; return next; continue; end if;
        insert into supplier_ledger_entries(id, shop_id, supplier_id, member_id, entry_type, amount_paise, scan_entry_id, entry_date, note, client_created_at)
        values (v_new, m.shop_id, e.party_id_final, m.id, 'notebook_import', case when v_dir = 'debit' then v_amt else -v_amt end, e.id,
                coalesce(e.entry_date_final, e.entry_date), coalesce(e.description_final, e.description, 'Imported from notebook'), now());
        imported_table := 'supplier_ledger_entries';
      elsif sc.kind = 'expenses' then
        insert into expenses(id, shop_id, member_id, category_name, amount_paise, paid_method, expense_date, note, status, scan_entry_id, client_created_at)
        values (v_new, m.shop_id, m.id, coalesce(e.description_final, e.description, 'Other'), v_amt, 'cash', coalesce(e.entry_date_final, e.entry_date),
                'Imported from notebook', 'approved', e.id, now());
        imported_table := 'expenses';
      else
        error := 'Import of ' || sc.kind::text || ' not supported in V1'; return next; continue;
      end if;
      update notebook_entries set status = 'imported', imported_record_table = imported_table, imported_record_id = v_new,
        reviewed_by_member_id = m.id, reviewed_at = now() where id = e.id;
      imported_id := v_new;
      return next;
    exception when others then
      error := sqlerrm; return next;
    end;
  end loop;
  -- mark scans fully imported when no pending entries remain
  update notebook_scans s set status = 'imported'
  where s.shop_id = m.shop_id and s.id in (select scan_id from notebook_entries where id = any(p_entry_ids))
    and not exists (select 1 from notebook_entries ne where ne.scan_id = s.id and ne.status in ('pending','approved'));
  return;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting (deterministic numbers for dashboard and AI assistant)
-- ---------------------------------------------------------------------------
create or replace function daily_summary(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m shop_members; tz text; d date; d_start timestamptz; d_end timestamptz; r jsonb;
begin
  m := _require_member();
  select timezone into tz from shops where id = m.shop_id;
  d := coalesce(p_date, (now() at time zone tz)::date);
  d_start := (d::timestamp) at time zone tz;
  d_end := d_start + interval '1 day';
  select jsonb_build_object(
    'date', d,
    'sales_count', (select count(*) from sales where shop_id = m.shop_id and status <> 'reversed' and client_created_at >= d_start and client_created_at < d_end),
    'sales_total_paise', coalesce((select sum(total_paise) from sales where shop_id = m.shop_id and status <> 'reversed' and client_created_at >= d_start and client_created_at < d_end), 0),
    'cash_sales_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='cash' and sale_id is not null and status <> 'failed' and client_created_at >= d_start and client_created_at < d_end), 0),
    'upi_sales_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='upi' and sale_id is not null and status <> 'failed' and client_created_at >= d_start and client_created_at < d_end), 0),
    'upi_pending_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='upi' and status = 'pending_verification' and client_created_at >= d_start and client_created_at < d_end), 0),
    'credit_sales_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='credit' and client_created_at >= d_start and client_created_at < d_end), 0),
    'khata_collected_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and sale_id is null and status <> 'failed' and client_created_at >= d_start and client_created_at < d_end), 0),
    'refunds_paise', coalesce((select sum(amount_paise) from refunds where shop_id = m.shop_id and client_created_at >= d_start and client_created_at < d_end), 0),
    'expenses_paise', coalesce((select sum(amount_paise) from expenses where shop_id = m.shop_id and status <> 'rejected' and expense_date = d), 0),
    'expenses_pending_count', (select count(*) from expenses where shop_id = m.shop_id and status = 'pending_approval'),
    'supplier_paid_paise', coalesce((select sum(-amount_paise) from supplier_ledger_entries where shop_id = m.shop_id and entry_type='payment' and entry_date = d), 0),
    'purchases_paise', coalesce((select sum(total_paise) from purchases where shop_id = m.shop_id and invoice_date = d), 0),
    'outstanding_customer_paise', coalesce((select sum(balance_paise) from customers where shop_id = m.shop_id and balance_paise > 0), 0),
    'outstanding_supplier_paise', coalesce((select sum(balance_paise) from suppliers where shop_id = m.shop_id and balance_paise > 0), 0),
    'low_stock_count', (select count(*) from products where shop_id = m.shop_id and is_active and stock_qty <= min_stock_qty and min_stock_qty > 0),
    'open_shifts', (select coalesce(jsonb_agg(jsonb_build_object('shift_id', s.id, 'member', sm.display_name, 'opened_at', s.opened_at)), '[]'::jsonb)
                    from shifts s join shop_members sm on sm.id = s.member_id where s.shop_id = m.shop_id and s.status = 'open'),
    'closed_shifts', (select coalesce(jsonb_agg(jsonb_build_object('shift_id', s.id, 'member', sm.display_name, 'expected_paise', s.expected_cash_paise, 'counted_paise', s.counted_cash_paise, 'difference_paise', s.cash_difference_paise) order by s.closed_at), '[]'::jsonb)
                      from shifts s join shop_members sm on sm.id = s.member_id where s.shop_id = m.shop_id and s.status = 'closed' and s.closed_at >= d_start and s.closed_at < d_end),
    'pending_approvals', (select count(*) from approval_requests where shop_id = m.shop_id and status = 'pending'),
    'by_employee', (select coalesce(jsonb_agg(jsonb_build_object('member', sm.display_name, 'sales_count', x.c, 'sales_paise', x.t)), '[]'::jsonb)
                    from (select member_id, count(*) c, sum(total_paise) t from sales where shop_id = m.shop_id and status <> 'reversed' and client_created_at >= d_start and client_created_at < d_end group by member_id) x
                    join shop_members sm on sm.id = x.member_id)
  ) into r;
  return r;
end $$;

create or replace function sales_summary_range(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m shop_members; tz text; s timestamptz; e timestamptz;
begin
  m := _require_member();
  select timezone into tz from shops where id = m.shop_id;
  s := (p_from::timestamp) at time zone tz; e := ((p_to + 1)::timestamp) at time zone tz;
  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_count', (select count(*) from sales where shop_id = m.shop_id and status <> 'reversed' and client_created_at >= s and client_created_at < e),
    'sales_total_paise', coalesce((select sum(total_paise) from sales where shop_id = m.shop_id and status <> 'reversed' and client_created_at >= s and client_created_at < e), 0),
    'cash_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='cash' and status<>'failed' and client_created_at >= s and client_created_at < e), 0),
    'upi_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='upi' and status<>'failed' and client_created_at >= s and client_created_at < e), 0),
    'credit_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='credit' and client_created_at >= s and client_created_at < e), 0),
    'expenses_paise', coalesce((select sum(amount_paise) from expenses where shop_id = m.shop_id and status <> 'rejected' and expense_date between p_from and p_to), 0),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'sales_paise', t, 'count', c) order by d), '[]'::jsonb)
               from (select (client_created_at at time zone tz)::date d, sum(total_paise) t, count(*) c from sales
                     where shop_id = m.shop_id and status <> 'reversed' and client_created_at >= s and client_created_at < e group by 1) x),
    'top_products', (select coalesce(jsonb_agg(jsonb_build_object('product', description, 'qty', q, 'paise', t) order by t desc), '[]'::jsonb)
                     from (select si.description, sum(si.qty) q, sum(si.line_total_paise) t from sale_items si join sales sa on sa.id = si.sale_id
                           where sa.shop_id = m.shop_id and sa.status <> 'reversed' and sa.client_created_at >= s and sa.client_created_at < e
                           group by si.description order by t desc limit 10) y)
  );
end $$;

-- Unusual patterns: described neutrally. Never labelled as theft.
create or replace function anomaly_report(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m shop_members;
begin
  m := _require_manager();
  return jsonb_build_object(
    'cash_differences', (select coalesce(jsonb_agg(jsonb_build_object('date', s.closed_at::date, 'member', sm.display_name, 'difference_paise', s.cash_difference_paise) order by s.closed_at desc), '[]'::jsonb)
                         from shifts s join shop_members sm on sm.id = s.member_id
                         where s.shop_id = m.shop_id and s.status='closed' and s.closed_at >= now() - (p_days || ' days')::interval and abs(coalesce(s.cash_difference_paise,0)) > 0),
    'large_discounts', (select coalesce(jsonb_agg(jsonb_build_object('sale_id', sa.id, 'member', sm.display_name, 'discount_paise', sa.discount_paise, 'total_paise', sa.total_paise, 'at', sa.client_created_at) order by sa.discount_paise desc), '[]'::jsonb)
                        from sales sa join shop_members sm on sm.id = sa.member_id
                        where sa.shop_id = m.shop_id and sa.client_created_at >= now() - (p_days || ' days')::interval and sa.subtotal_paise > 0 and sa.discount_paise::numeric*100/sa.subtotal_paise >= 10),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('sale_id', r.sale_id, 'member', sm.display_name, 'amount_paise', r.amount_paise, 'reason', r.reason, 'at', r.client_created_at) order by r.client_created_at desc), '[]'::jsonb)
                from refunds r join shop_members sm on sm.id = r.member_id where r.shop_id = m.shop_id and r.client_created_at >= now() - (p_days || ' days')::interval),
    'stock_adjustments', (select coalesce(jsonb_agg(jsonb_build_object('product', p.name, 'type', mv.movement_type, 'qty_delta', mv.qty_delta, 'reason', mv.reason, 'member', sm.display_name, 'at', mv.created_at) order by mv.created_at desc), '[]'::jsonb)
                          from stock_movements mv join products p on p.id = mv.product_id left join shop_members sm on sm.id = mv.member_id
                          where mv.shop_id = m.shop_id and mv.movement_type in ('damage','expiry','wastage','count_adjustment','manual_adjustment') and mv.created_at >= now() - (p_days || ' days')::interval),
    'unverified_upi_paise', coalesce((select sum(amount_paise) from payments where shop_id = m.shop_id and method='upi' and status='pending_verification' and client_created_at >= now() - (p_days || ' days')::interval), 0)
  );
end $$;

create or replace function customer_statement(p_customer_id uuid, p_limit int default 50)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'customer', (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'balance_paise', balance_paise) from customers where id = p_customer_id and shop_id = current_shop_id()),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', entry_type, 'amount_paise', amount_paise, 'date', entry_date, 'note', note, 'sale_id', sale_id) order by entry_date desc, created_at desc), '[]'::jsonb)
                from (select * from customer_ledger_entries where customer_id = p_customer_id and shop_id = current_shop_id() order by entry_date desc, created_at desc limit p_limit) x)
  )
$$;

create or replace function product_stock_report()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'low_stock', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock_qty', stock_qty, 'unit', unit, 'min_stock_qty', min_stock_qty) order by stock_qty), '[]'::jsonb)
                  from products where shop_id = current_shop_id() and is_active and min_stock_qty > 0 and stock_qty <= min_stock_qty),
    'negative_stock', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock_qty', stock_qty, 'unit', unit)), '[]'::jsonb)
                       from products where shop_id = current_shop_id() and is_active and stock_qty < 0),
    'total_products', (select count(*) from products where shop_id = current_shop_id() and is_active)
  )
$$;

-- Incremental pull for sync: everything in the shop changed after a cursor, per table.
create or replace function pull_changes(p_since timestamptz, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m shop_members; r jsonb;
begin
  m := _require_member();
  select jsonb_build_object(
    'server_time', now(),
    'products', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select * from products where shop_id = m.shop_id and updated_at > p_since order by updated_at limit p_limit) p),
    'categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from categories where shop_id = m.shop_id and updated_at > p_since order by updated_at limit p_limit) c),
    'customers', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from (select * from customers where shop_id = m.shop_id and updated_at > p_since order by updated_at limit p_limit) c),
    'suppliers', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (select * from suppliers where shop_id = m.shop_id and updated_at > p_since order by updated_at limit p_limit) s),
    'expense_categories', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from expense_categories c where shop_id = m.shop_id),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'display_name', display_name, 'role', role, 'is_active', is_active, 'permissions', permissions, 'updated_at', updated_at)), '[]'::jsonb) from shop_members where shop_id = m.shop_id),
    'sales', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (select * from sales where shop_id = m.shop_id and updated_at > p_since and (m.role <> 'employee' or member_id = m.id) order by updated_at limit p_limit) s),
    'sale_items', (select coalesce(jsonb_agg(to_jsonb(si)), '[]'::jsonb) from (select si.* from sale_items si join sales s on s.id = si.sale_id where si.shop_id = m.shop_id and s.updated_at > p_since and (m.role <> 'employee' or s.member_id = m.id) order by s.updated_at limit p_limit) si),
    'payments', (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from (select * from payments where shop_id = m.shop_id and updated_at > p_since and (m.role <> 'employee' or member_id = m.id) order by updated_at limit p_limit) p),
    'customer_ledger_entries', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (select * from customer_ledger_entries where shop_id = m.shop_id and created_at > p_since order by created_at limit p_limit) e),
    'expenses', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (select * from expenses where shop_id = m.shop_id and updated_at > p_since and (m.role <> 'employee' or member_id = m.id) order by updated_at limit p_limit) e),
    'shifts', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from (select * from shifts where shop_id = m.shop_id and updated_at > p_since and (m.role <> 'employee' or member_id = m.id) order by updated_at limit p_limit) s),
    'stock_movements', (select coalesce(jsonb_agg(to_jsonb(mv)), '[]'::jsonb) from (select * from stock_movements where shop_id = m.shop_id and created_at > p_since order by created_at limit p_limit) mv)
  ) into r;
  return r;
end $$;

-- Low-stock + payment reminder queueing (call from a scheduled job or manually from owner dashboard)
create or replace function queue_daily_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare m shop_members; sh shops; n int := 0;
begin
  m := _require_manager();
  select * into sh from shops where id = m.shop_id;
  insert into notifications_outbox(shop_id, recipient, template, payload)
  values (m.shop_id, coalesce(sh.phone,''), 'daily_report', daily_summary(null));
  n := n + 1;
  if (product_stock_report()->'low_stock') <> '[]'::jsonb then
    insert into notifications_outbox(shop_id, recipient, template, payload)
    values (m.shop_id, coalesce(sh.phone,''), 'low_stock', product_stock_report());
    n := n + 1;
  end if;
  insert into notifications_outbox(shop_id, recipient, template, payload)
  select m.shop_id, c.phone, 'payment_reminder', jsonb_build_object('customer', c.name, 'balance_paise', c.balance_paise)
  from customers c where c.shop_id = m.shop_id and c.phone is not null and c.balance_paise >= coalesce((sh.settings->>'reminder_threshold_paise')::bigint, 50000);
  n := n + (select count(*) from customers c where c.shop_id = m.shop_id and c.phone is not null and c.balance_paise >= coalesce((sh.settings->>'reminder_threshold_paise')::bigint, 50000));
  return n;
end $$;

grant execute on all functions in schema public to authenticated;
revoke execute on function verify_member_pin(uuid, uuid, text) from authenticated, anon;
revoke execute on function lookup_shop_by_code(text) from authenticated, anon;
