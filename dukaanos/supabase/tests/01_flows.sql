-- Behavioural tests for the transactional RPCs. Run with `npm run db:test`.
-- Uses plain asserts; any failure aborts with an exception.
\set ON_ERROR_STOP on
begin;

-- Two auth users: owner and employee
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'owner@test.local'),
  ('00000000-0000-0000-0000-000000000002', 'emp@test.local');

-- ---- act as OWNER ---------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select create_shop('Sharma Kirana', 'Sharma ji', '9999999999');

do $$
declare v_shop uuid := current_shop_id(); v_emp uuid;
begin
  assert v_shop is not null, 'owner must belong to shop';
  assert current_role_name() = 'owner', 'role must be owner';
  -- add an employee with limited permissions
  insert into shop_members(shop_id, user_id, role, display_name, permissions)
  values (v_shop, '00000000-0000-0000-0000-000000000002', 'employee', 'Ramu',
          '{"can_refund":false,"can_discount":true,"max_discount_pct":5,"can_receive_stock":true,"can_adjust_stock":false,"can_record_expense":true}'::jsonb)
  returning id into v_emp;
  perform set_member_pin(v_emp, '1234');
  -- products (prices in paise)
  insert into products(id, shop_id, name, aliases, unit, is_loose, selling_price_paise, purchase_price_paise, min_stock_qty, is_quick)
  values ('10000000-0000-0000-0000-000000000001', v_shop, 'Rice (Basmati)', '{chawal,rice}', 'kg', true, 8000, 6500, 5, true),
         ('10000000-0000-0000-0000-000000000002', v_shop, 'Sugar', '{chini,cheeni}', 'kg', true, 4500, 4000, 10, true),
         ('10000000-0000-0000-0000-000000000003', v_shop, 'Parle-G', '{biscuit}', 'pkt', false, 1000, 850, 20, true);
  insert into customers(id, shop_id, name, phone) values ('20000000-0000-0000-0000-000000000001', v_shop, 'Ramesh', '8888888888');
  insert into suppliers(id, shop_id, name) values ('30000000-0000-0000-0000-000000000001', v_shop, 'Gupta Wholesale');
  -- opening stock
  perform post_stock_adjustment(jsonb_build_object('id','40000000-0000-0000-0000-000000000001','product_id','10000000-0000-0000-0000-000000000001','movement_type','opening','qty_delta',50,'reason','opening'));
  perform post_stock_adjustment(jsonb_build_object('id','40000000-0000-0000-0000-000000000002','product_id','10000000-0000-0000-0000-000000000002','movement_type','opening','qty_delta',30,'reason','opening'));
  assert (select stock_qty from products where id='10000000-0000-0000-0000-000000000001') = 50, 'opening stock applied';
  -- customer opening balance ₹500
  perform post_khata_entry(jsonb_build_object('id','50000000-0000-0000-0000-000000000001','customer_id','20000000-0000-0000-0000-000000000001','entry_type','opening_balance','amount_paise',50000,'note','From old notebook'));
  assert (select balance_paise from customers where id='20000000-0000-0000-0000-000000000001') = 50000, 'opening balance applied';
end $$;

-- ---- act as EMPLOYEE ------------------------------------------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);

do $$
declare v_shift shifts; v_sale sales; v_sale2 sales; v_pay payments; v_exp expenses; c record; v_closed shifts; v_pu purchases; failed boolean;
begin
  assert current_role_name() = 'employee', 'role must be employee';
  -- employee cannot see purchase price? (RLS still returns row; app hides; permission exists for UI) — skip
  -- employee cannot insert products
  begin
    insert into products(shop_id, name, unit, selling_price_paise) values (current_shop_id(), 'Hack', 'pc', 1);
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'employee must not create products';

  -- open shift with ₹1000 float
  v_shift := open_shift('60000000-0000-0000-0000-000000000001', 100000);
  assert v_shift.status = 'open', 'shift open';
  assert (open_shift('60000000-0000-0000-0000-000000000001', 100000)).id = v_shift.id, 'open_shift idempotent';

  -- Sale 1: 2 kg rice (₹160) + 1 pkt Parle-G (₹10) = ₹170; cash ₹100 + UPI ₹70
  v_sale := post_sale(jsonb_build_object(
    'id','70000000-0000-0000-0000-000000000001','client_created_at', now(),'source','manual',
    'subtotal_paise',17000,'discount_paise',0,'total_paise',17000,
    'items', jsonb_build_array(
      jsonb_build_object('id','71000000-0000-0000-0000-000000000001','product_id','10000000-0000-0000-0000-000000000001','description','Rice (Basmati)','unit','kg','qty',2,'unit_price_paise',8000,'line_total_paise',16000),
      jsonb_build_object('id','71000000-0000-0000-0000-000000000002','product_id','10000000-0000-0000-0000-000000000003','description','Parle-G','unit','pkt','qty',1,'unit_price_paise',1000,'line_total_paise',1000)),
    'payments', jsonb_build_array(
      jsonb_build_object('id','72000000-0000-0000-0000-000000000001','method','cash','amount_paise',10000),
      jsonb_build_object('id','72000000-0000-0000-0000-000000000002','method','upi','amount_paise',7000,'upi_reference','UPI123'))));
  assert v_sale.total_paise = 17000, 'sale total';
  assert v_sale.shift_id = v_shift.id, 'sale attached to open shift';
  assert (select stock_qty from products where id='10000000-0000-0000-0000-000000000001') = 48, 'rice stock deducted (50-2)';
  assert (select stock_qty from products where id='10000000-0000-0000-0000-000000000003') = -1, 'parle-g went negative (no opening stock) and is visible';
  -- idempotent replay must NOT duplicate
  v_sale2 := post_sale(jsonb_build_object('id','70000000-0000-0000-0000-000000000001','subtotal_paise',17000,'discount_paise',0,'total_paise',17000,'client_created_at',now(),
    'items', jsonb_build_array(jsonb_build_object('id','71000000-0000-0000-0000-000000000001','product_id','10000000-0000-0000-0000-000000000001','description','x','unit','kg','qty',2,'unit_price_paise',8000,'line_total_paise',16000),
                               jsonb_build_object('id','71000000-0000-0000-0000-000000000002','description','y','unit','pkt','qty',1,'unit_price_paise',1000,'line_total_paise',1000)),
    'payments', jsonb_build_array(jsonb_build_object('id','72000000-0000-0000-0000-000000000001','method','cash','amount_paise',17000))));
  assert v_sale2.id = v_sale.id, 'replay returns same sale';
  assert (select count(*) from sales where shop_id = current_shop_id()) = 1, 'no duplicate sale';
  assert (select stock_qty from products where id='10000000-0000-0000-0000-000000000001') = 48, 'replay did not deduct stock twice';

  -- Sale 2: credit sale ₹90 (2 kg sugar) to Ramesh
  perform post_sale(jsonb_build_object('id','70000000-0000-0000-0000-000000000002','client_created_at',now(),'customer_id','20000000-0000-0000-0000-000000000001',
    'subtotal_paise',9000,'discount_paise',0,'total_paise',9000,
    'items', jsonb_build_array(jsonb_build_object('id','71000000-0000-0000-0000-000000000003','product_id','10000000-0000-0000-0000-000000000002','description','Sugar','unit','kg','qty',2,'unit_price_paise',4500,'line_total_paise',9000)),
    'payments', jsonb_build_array(jsonb_build_object('id','72000000-0000-0000-0000-000000000003','method','credit','amount_paise',9000))));
  assert (select balance_paise from customers where id='20000000-0000-0000-0000-000000000001') = 59000, 'khata increased by 90 → 590';

  -- credit sale without customer must fail
  begin
    perform post_sale(jsonb_build_object('id','70000000-0000-0000-0000-000000000003','client_created_at',now(),'subtotal_paise',1000,'discount_paise',0,'total_paise',1000,
      'items', jsonb_build_array(jsonb_build_object('id','71000000-0000-0000-0000-000000000009','description','x','unit','pc','qty',1,'unit_price_paise',1000,'line_total_paise',1000)),
      'payments', jsonb_build_array(jsonb_build_object('id','72000000-0000-0000-0000-000000000009','method','credit','amount_paise',1000))));
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'credit without customer rejected';

  -- discount above employee limit (5%) must fail: 10% discount
  begin
    perform post_sale(jsonb_build_object('id','70000000-0000-0000-0000-000000000004','client_created_at',now(),'subtotal_paise',10000,'discount_paise',1000,'total_paise',9000,
      'items', jsonb_build_array(jsonb_build_object('id','71000000-0000-0000-0000-000000000010','description','x','unit','pc','qty',1,'unit_price_paise',10000,'line_total_paise',10000)),
      'payments', jsonb_build_array(jsonb_build_object('id','72000000-0000-0000-0000-000000000010','method','cash','amount_paise',9000))));
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'discount over limit rejected';

  -- payments must equal total
  begin
    perform post_sale(jsonb_build_object('id','70000000-0000-0000-0000-000000000005','client_created_at',now(),'subtotal_paise',10000,'discount_paise',0,'total_paise',10000,
      'items', jsonb_build_array(jsonb_build_object('id','71000000-0000-0000-0000-000000000011','description','x','unit','pc','qty',1,'unit_price_paise',10000,'line_total_paise',10000)),
      'payments', jsonb_build_array(jsonb_build_object('id','72000000-0000-0000-0000-000000000011','method','cash','amount_paise',5000))));
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'short payment rejected';

  -- Ramesh pays ₹200 cash against khata
  v_pay := post_khata_payment(jsonb_build_object('id','72000000-0000-0000-0000-000000000020','customer_id','20000000-0000-0000-0000-000000000001','method','cash','amount_paise',20000));
  assert (select balance_paise from customers where id='20000000-0000-0000-0000-000000000001') = 39000, 'khata reduced → 390';

  -- Expense: chai ₹30 cash
  v_exp := post_expense(jsonb_build_object('id','80000000-0000-0000-0000-000000000001','category_name','Tea/Chai','amount_paise',3000,'paid_method','cash'));
  assert v_exp.status = 'recorded', 'expense recorded';

  -- employee cannot refund (no permission)
  begin
    perform post_refund(jsonb_build_object('id','90000000-0000-0000-0000-000000000001','sale_id','70000000-0000-0000-0000-000000000001','method','cash','amount_paise',1000,'reason','test'));
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'employee refund rejected';

  -- employee cannot adjust stock (no permission)
  begin
    perform post_stock_adjustment(jsonb_build_object('id','40000000-0000-0000-0000-000000000009','product_id','10000000-0000-0000-0000-000000000001','movement_type','damage','qty_delta',-1,'reason','x'));
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'employee stock adjustment rejected';

  -- Receive purchase (employee has can_receive_stock): 25 kg rice @ ₹60 = ₹1500, paid ₹500 cash on receipt
  v_pu := receive_purchase(jsonb_build_object('id','a0000000-0000-0000-0000-000000000001','supplier_id','30000000-0000-0000-0000-000000000001','invoice_date',current_date,'client_created_at',now(),
    'items', jsonb_build_array(jsonb_build_object('id','a1000000-0000-0000-0000-000000000001','product_id','10000000-0000-0000-0000-000000000001','description','Rice','unit','kg','qty',25,'unit_cost_paise',6000,'line_total_paise',150000)),
    'paid_paise',50000,'paid_method','cash'));
  assert (select stock_qty from products where id='10000000-0000-0000-0000-000000000001') = 73, 'rice stock increased 48+25';
  assert (select purchase_price_paise from products where id='10000000-0000-0000-0000-000000000001') = 6000, 'purchase price updated';
  assert (select balance_paise from suppliers where id='30000000-0000-0000-0000-000000000001') = 100000, 'supplier owed 1500-500 = ₹1000';

  -- Expected cash: 1000 (opening) + 100 (cash sale) + 200 (khata) - 0 - 30 (chai) - 500 (supplier) = ₹770
  select * into c from shift_cash_summary(v_shift.id);
  assert c.expected_cash_paise = 77000, 'expected cash = ₹770, got ' || c.expected_cash_paise;
  assert c.credit_sales_paise = 9000, 'credit separate from cash';
  assert c.upi_sales_paise = 7000, 'upi separate';

  -- Close with ₹750 counted → difference -₹20
  v_closed := close_shift(v_shift.id, 75000, 'short by 20');
  assert v_closed.status = 'closed' and v_closed.cash_difference_paise = -2000, 'difference -2000';
  assert (close_shift(v_shift.id, 99999)).counted_cash_paise = 75000, 'close_shift idempotent (second call ignored)';

  -- employee cannot silently edit a sale
  begin
    update sales set total_paise = 1 where id = '70000000-0000-0000-0000-000000000001';
  exception when others then null; end;
  assert (select total_paise from sales where id = '70000000-0000-0000-0000-000000000001') = 17000, 'sale totals immutable';
  begin
    delete from sale_items where sale_id = '70000000-0000-0000-0000-000000000001';
    failed := false;
  exception when others then failed := true; end;
  assert failed, 'sale items immutable';
end $$;

-- ---- back to OWNER: reports, refund, anomaly, notebook import --------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
declare d jsonb; r refunds; res record; v_scan uuid := 'b0000000-0000-0000-0000-000000000001';
begin
  d := daily_summary(null);
  assert (d->>'sales_total_paise')::bigint = 26000, 'daily sales ₹260: ' || d::text;
  assert (d->>'cash_sales_paise')::bigint = 10000, 'cash sales 100';
  assert (d->>'credit_sales_paise')::bigint = 9000, 'credit 90';
  assert (d->>'expenses_paise')::bigint = 3000, 'expenses 30';
  assert (d->>'outstanding_customer_paise')::bigint = 39000, 'outstanding 390';
  assert jsonb_array_length(d->'closed_shifts') = 1, 'one closed shift';

  -- owner refunds ₹10 cash from sale 1
  r := post_refund(jsonb_build_object('id','90000000-0000-0000-0000-000000000002','sale_id','70000000-0000-0000-0000-000000000001','method','cash','amount_paise',1000,'reason','Damaged biscuit'));
  assert (select status from sales where id='70000000-0000-0000-0000-000000000001') = 'partially_refunded', 'partial refund status';
  assert (anomaly_report(7)->'refunds') <> '[]'::jsonb, 'refund visible in anomaly report';

  -- notebook: one scan with 3 entries → approve 2, one unmatched
  insert into notebook_scans(id, shop_id, member_id, kind, batch_id, page_number, image_path, status)
  values (v_scan, current_shop_id(), current_member_id(), 'customer_khata', gen_random_uuid(), 1, current_shop_id()::text || '/p1.jpg', 'extracted');
  insert into notebook_entries(id, scan_id, shop_id, row_index, party_name, entry_date, amount_paise, direction, confidence, status, party_id_final, entry_date_final, amount_paise_final, direction_final)
  values ('b1000000-0000-0000-0000-000000000001', v_scan, current_shop_id(), 0, 'Ramesh', '2026-10-01', 15000, 'debit', 0.92, 'approved', '20000000-0000-0000-0000-000000000001', '2026-10-01', 15000, 'debit'),
         ('b1000000-0000-0000-0000-000000000002', v_scan, current_shop_id(), 1, 'Ramesh', '2026-10-05', 5000, 'credit', 0.88, 'approved', '20000000-0000-0000-0000-000000000001', '2026-10-05', 5000, 'credit'),
         ('b1000000-0000-0000-0000-000000000003', v_scan, current_shop_id(), 2, 'Sur??', null, null, 'unknown', 0.31, 'pending', null, null, null, null);
  for res in select * from import_notebook_entries(array['b1000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000002','b1000000-0000-0000-0000-000000000003']::uuid[]) loop
    if res.entry_id = 'b1000000-0000-0000-0000-000000000003' then assert res.error is not null, 'pending entry not imported';
    else assert res.error is null and res.imported_table = 'customer_ledger_entries', 'approved entry imported: ' || coalesce(res.error,''); end if;
  end loop;
  assert (select balance_paise from customers where id='20000000-0000-0000-0000-000000000001') = 39000 + 15000 - 5000, 'import adjusted balance';
  -- re-import is idempotent
  for res in select * from import_notebook_entries(array['b1000000-0000-0000-0000-000000000001']::uuid[]) loop
    assert res.error is null, 'replay import ok';
  end loop;
  assert (select count(*) from customer_ledger_entries where scan_entry_id = 'b1000000-0000-0000-0000-000000000001') = 1, 'no duplicate import';
  assert (select count(*) from audit_log where shop_id = current_shop_id()) > 10, 'audit log populated';
end $$;

-- ---- isolation: a third user with no shop sees nothing --------------------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$
begin
  assert (select count(*) from products) = 0, 'outsider sees no products';
  assert (select count(*) from sales) = 0, 'outsider sees no sales';
end $$;

reset role;
select 'ALL DB TESTS PASSED' as result;
rollback;
