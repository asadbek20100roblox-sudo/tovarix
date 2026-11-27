import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('tenant isolation, stock atomicity and idempotent checkout', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql => db.exec(sql));
    await db.exec(login(1));
    const { rows: [{ id: business }] } = await db.query("select public.open_business('Shop', 'Main') as id");
    const { rows: [{ id: store }] } = await db.query('select id from public.stores');
    const { rows: [{ id: product }] } = await db.query("insert into public.products(business_id,name,barcode,price,cost) values ($1,'Tea','TVX0001',5000,3000) returning id", [business]);
    await db.query("select public.adjust_stock($1,$2,$3,3,'Initial')", [business, store, product]);
    await db.query('select public.change_shift($1,$2,0,false)', [business, store]);
    const request = '00000000-0000-0000-0000-000000000009';
    const checkout = quantity => db.query('select public.checkout($1,$2,$3,$4,5000,0,0,5000) as id', [business, store, request, JSON.stringify([{ product_id: product, quantity }])]);
    const first = await checkout(1);
    assert.deepEqual((await checkout(1)).rows, first.rows);
    await assert.rejects(checkout(2), /different payload/);
    await assert.rejects(db.query('select public.checkout($1,$2,gen_random_uuid(),$3,15000,0,0,15000)', [business, store, JSON.stringify([{ product_id: product, quantity: 3 }])]), /insufficient stock/);
    assert.equal((await db.query('select quantity from public.stock')).rows[0].quantity, '2.000');
    assert.equal((await db.query('select count(*)::int as n from public.sales')).rows[0].n, 1);
    const sale = first.rows[0].id;
    await db.query("select public.return_sale($1,$2,'Customer return')", [business, sale]);
    await assert.rejects(db.query("select public.return_sale($1,$2,'Again')", [business, sale]), /already returned/);
    assert.equal((await db.query('select quantity from public.stock')).rows[0].quantity, '3.000');
    await db.query('select public.change_shift($1,$2,0,true)', [business, store]);
    assert.deepEqual((await checkout(1)).rows, first.rows);
    await assert.rejects(db.query('select public.checkout($1,$2,gen_random_uuid(),$3,5000,0,0,5000)', [business, store, JSON.stringify([{ product_id: product, quantity: 1 }])]), /no open shift/);
    await assert.rejects(db.query("select public.set_staff($1,$2,'cashier',array['sell'])", [business, user(2)]), /employee limit reached/);
    await assert.rejects(db.query('select public.ai_context($1)', [business]), /AI disabled/);
    await assert.rejects(db.query("select public.capture_payment('relay','event','order',119000,'UZS')"), /permission denied/);

    await db.exec('set role service_role');
    await assert.rejects(db.query("select public.open_billing_order($1,'STANDARD',1,'relay','order')", [business]), /permission denied/);
    await db.exec(`reset role;
      grant execute on function public.capture_payment(text,text,text,bigint,text),
        commerce_private.capture_payment(text,text,text,bigint,text),
        public.open_billing_order(uuid,text,integer,text,text),commerce_private.open_billing_order(uuid,text,integer,text,text),
        public.open_promo_order(uuid,text,integer,text,text,text),commerce_private.open_promo_order(uuid,text,integer,text,text,text)
        to service_role;
      set role service_role`);
    await db.query("select public.open_billing_order($1,'STANDARD',1,'relay','order')", [business]);
    await assert.rejects(db.query("select public.capture_payment('relay','event','order',1,'UZS')"), /order mismatch/);
    assert.equal((await db.query("select public.capture_payment('relay','event','order',119000,'UZS') as captured")).rows[0].captured, true);
    assert.equal((await db.query("select public.capture_payment('relay','event','order',119000,'UZS') as captured")).rows[0].captured, false);
    await db.exec("select public.issue_promo('TEST001',10,now()+interval '1 day')");
    await db.exec("select public.issue_promo('TEST002',10,now()+interval '1 day')");
    await assert.rejects(db.query("select public.issue_promo('TEST003',10,now()+interval '1 day')"), /monthly promo limit/);

    await db.exec(login(1));
    assert.equal((await db.query('select plan from public.subscriptions')).rows[0].plan, 'STANDARD');
    await db.query("select public.set_staff($1,$2,'cashier',array['sell'])", [business, user(3)]);
    assert.equal((await db.query("select public.redeem_promo($1,'TEST001') as discount", [business])).rows[0].discount, 10);
    await assert.rejects(db.query("select public.redeem_promo($1,'TEST001')", [business]), /already used/);
    await db.exec('set role service_role');
    assert.equal((await db.query("select public.open_promo_order($1,'STANDARD',1,'relay','promo-order','TEST001') as amount", [business])).rows[0].amount, 107100);
    await assert.rejects(db.query("select public.open_promo_order($1,'STANDARD',1,'relay','promo-order2','TEST001')", [business]), /already assigned/);
    await assert.rejects(db.query("select public.capture_payment('relay','promo-event','promo-order',119000,'UZS')"), /order mismatch/);
    assert.equal((await db.query("select public.capture_payment('relay','promo-event','promo-order',107100,'UZS') as captured")).rows[0].captured, true);
    await db.exec(login(1));
    await assert.rejects(db.query("insert into public.stores(business_id,name) values($1,'Over limit')", [business]), /resource limit/);
    await db.exec('reset role');
    await db.query("update public.subscriptions set plan='PLUS' where business_id=$1", [business]);
    await db.exec(login(1));
    const { rows: [{ id: otherStore }] } = await db.query("insert into public.stores(business_id,name) values($1,'Second') returning id", [business]);
    const { rows: [{ id: weighted }] } = await db.query(
      `insert into public.products(business_id,name,barcode,price,cost,attributes) values($1,'Bulk','WEIGHT',5,3,'{"unit":"kg"}') returning id`, [business]);
    await db.query("select public.receive_purchase_batch($1,$2,null,'BATCH-A',$3)", [business, store,
      JSON.stringify([{ product_id: weighted, quantity: 2, total: 6 }, { product_id: product, quantity: 1, total: 3000 }])]);
    await db.query("select public.count_stock($1,$2,$3,2,1.5,'Counted')", [business, store, weighted]);
    await assert.rejects(db.query("select public.count_stock($1,$2,$3,2,1,'Stale')", [business, store, weighted]), /stock changed/);
    await db.query('select public.change_shift($1,$2,0,false)', [business, store]);
    const weightedCheckout = (id, price, operator = user(1)) => db.query(
      'select public.checkout($1,$2,gen_random_uuid(),$3,3,0,0,3)', [business, store,
        JSON.stringify([{ product_id: id, quantity: 0.5, expected_price: price, operator_id: operator }])]);
    await assert.rejects(weightedCheckout(product, 5000), /weight product/);
    await assert.rejects(weightedCheckout(weighted, 6), /price changed/);
    await assert.rejects(weightedCheckout(weighted, 5, user(3)), /incorrect sale operator/);
    const { rows: [{ id: weighedSale }] } = await db.query(
      'select public.checkout($1,$2,gen_random_uuid(),$3,3,0,0,3) as id', [business, store,
        JSON.stringify([{ product_id: weighted, quantity: 0.5, expected_price: 5, operator_id: user(1) }])]);
    const returnRequest = '00000000-0000-0000-0000-000000000008';
    const returnPart = () => db.query("select public.partial_return($1,$2,$3,$4,0.25,'Return') as id", [business, weighedSale, returnRequest, weighted]);
    const firstPart = await returnPart();
    assert.deepEqual((await returnPart()).rows, firstPart.rows);
    await assert.rejects(db.query("select public.partial_return($1,$2,gen_random_uuid(),$3,0.5,'Excess')", [business, weighedSale, weighted]), /exceeds sold/);
    await assert.rejects(db.query("select public.return_sale($1,$2,'Full')", [business, weighedSale]), /remaining items/);
    await db.query("select public.record_expense($1,$2,200,'Delivery')", [business, store]);
    const { rows: [{ dashboard }] } = await db.query("select public.dashboard_cash($1,$2,now()-interval '1 day',now()+interval '1 day') as dashboard", [business, store]);
    assert.equal(dashboard.expenses, 200);
    assert.equal(dashboard.cash, 2);
    await db.query("select public.set_staff_display_name($1,$2,'Aziza Demo')", [business, user(3)]);
    assert.equal((await db.query("select display_name from public.members where user_id=$1", [user(3)])).rows[0].display_name, 'Aziza Demo');
    await db.query('select public.change_shift($1,$2,2,true)', [business, store]);
    const cash = (await db.query('select expected_cash,cash_variance from public.shifts order by opened_at desc limit 1')).rows[0];
    assert.equal(Number(cash.expected_cash), 2);
    assert.equal(Number(cash.cash_variance), 0);
    const { rows: [{ id: ticket }] } = await db.query(
      "insert into public.support_tickets(business_id,subject,message) values($1,'Receipt','Need help') returning id", [business]);
    await assert.rejects(db.query("select public.resolve_ticket($1,'No')", [ticket]), /permission denied/);
    await db.exec('reset role');
    await db.query('insert into commerce_private.platform_admins values($1)', [user(4)]);
    await db.exec(login(4));
    assert.equal((await db.query('select public.platform_overview() as panel')).rows[0].panel,null);
    await assert.rejects(db.query("select public.resolve_ticket($1,'No second factor')", [ticket]), /permission denied/);
    await db.exec(`set request.jwt.claims = '{"aal":"aal2"}'`);
    const {rows:[{ panel }]} = await db.query('select public.platform_overview() as panel');
    assert.equal(panel.tickets[0].id, ticket);
    await db.query("select public.resolve_ticket($1,'Resolved')", [ticket]);
    await db.exec(login(1));
    assert.equal((await db.query('select resolution from public.support_tickets')).rows[0].resolution, 'Resolved');
    await db.query('select public.set_store_scope($1,$2,$3)', [business, user(3), [store]]);
    const summary = await db.query('select public.billing_overview($1) as billing', [business]);
    assert.equal(summary.rows[0].billing.payments.length, 2);
    await db.exec(login(3));
    assert.equal((await db.query('select count(*)::int as n from public.products')).rows[0].n, 2);
    assert.deepEqual((await db.query('select id from public.stores')).rows, [{ id: store }]);
    await assert.rejects(db.query('select public.change_shift($1,$2,0,false)', [business, otherStore]), /permission denied/);
    await assert.rejects(db.query('select public.billing_overview($1)', [business]), /permission denied/);
    await assert.rejects(db.query("select public.set_staff_display_name($1,$2,'Self rename')", [business, user(3)]), /permission denied/);
    await assert.rejects(db.query("select public.dashboard_cash($1,$2,now()-interval '1 day',now())", [business, store]), /permission denied/);
    assert.equal((await db.query('select count(*)::int as n from public.sales')).rows[0].n, 0);
    await assert.rejects(db.query('select cost from public.products'), /permission denied/);
    await assert.rejects(db.query('select cost from public.sales'), /permission denied/);
    await assert.rejects(db.query('select items from public.sales'), /permission denied/);
    await assert.rejects(db.query('select cost from public.partial_returns'), /permission denied/);
    await assert.rejects(db.query('select total_uzs from public.purchases'), /permission denied/);
    assert.ok((await db.query('select cost from public.catalog_access')).rows.every(row => row.cost === null));
    await db.query('select public.change_shift($1,$2,0,false)', [business, store]);
    const { rows:[{ id: employeeSale }] } = await db.query(
      'select public.checkout($1,$2,gen_random_uuid(),$3,5000,0,0,5000) as id',
      [business,store,JSON.stringify([{ product_id: product, quantity: 1 }])]);
    const { rows:[receipt] } = await db.query('select cost,items from public.sales_access where id=$1',[employeeSale]);
    assert.equal(receipt.cost,null);
    assert.equal(receipt.items[0].partial_returnable,true);
    assert.equal('unit_cost' in receipt.items[0],false);
    await db.exec(login(1));
    assert.equal(Number((await db.query('select cost from public.catalog_access where id=$1',[product])).rows[0].cost),3000);
    await db.query("select public.set_staff($1,$2,'cashier',array['sell','cost'])",[business,user(3)]);
    await db.exec(login(3));
    assert.equal(Number((await db.query('select cost from public.sales_access where id=$1',[employeeSale])).rows[0].cost),3000);
    await db.exec(login(1));
    await db.query("select public.set_staff($1,$2,'cashier',array['sell','analytics','ai'])",[business,user(3)]);
    await db.query('select public.set_store_scope($1,$2,null)', [business,user(3)]);
    await db.exec('reset role');
    await db.exec('update commerce_private.platform_settings set ai_enabled=true');
    await db.exec(login(3));
    const { rows:[{ report: maskedReport }] } = await db.query(
      'select public.sales_report($1,current_date-1,current_date+2) as report',[business]);
    assert.ok(maskedReport.totals.revenue > 0);
    assert.equal(maskedReport.totals.profit,null);
    const {rows:[{ context: maskedContext }]} = await db.query('select public.ai_context($1) as context',[business]);
    assert.ok(maskedContext.daily_sales.length > 0);
    assert.ok(maskedContext.daily_sales.every(day => day.gross_profit_uzs === null));
    await db.exec(login(2));
    assert.deepEqual((await db.query('select id from public.products')).rows, []);
    await assert.rejects(db.query("select public.adjust_stock($1,$2,$3,1,'Other')", [business, store, product]), /permission denied/);
    await assert.rejects(checkout(1), /permission denied/);
  } finally {
    await db.close();
  }
});
