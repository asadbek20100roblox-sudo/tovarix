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
    await assert.rejects(db.query('select public.ai_context($1)', [business]), /permission denied/);
    await assert.rejects(db.query("select public.capture_payment('relay','event','order',119000,'UZS')"), /permission denied/);

    await db.exec('set role service_role');
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
    await db.exec(login(3));
    assert.equal((await db.query('select count(*)::int as n from public.products')).rows[0].n, 1);
    assert.equal((await db.query('select count(*)::int as n from public.sales')).rows[0].n, 0);
    await db.exec(login(2));
    assert.deepEqual((await db.query('select * from public.products')).rows, []);
    await assert.rejects(db.query("select public.adjust_stock($1,$2,$3,1,'Other')", [business, store, product]), /permission denied/);
    await assert.rejects(checkout(1), /permission denied/);
  } finally {
    await db.close();
  }
});
