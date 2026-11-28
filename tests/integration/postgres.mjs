import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { bootstrap, login } from '../bootstrap.mjs';

test('concurrent checkout serializes duplicates and competing stock deductions and debt repayments', async () => {
  const target = process.env.TOVARIX_TEST_POSTGRES;
  assert.ok(target, 'Use an empty disposable PostgreSQL instance');
  const clients = Array.from({ length: 3 }, () => new pg.Client({ connectionString: target }));
  try {
    await Promise.all(clients.map(db => db.connect()));
    const [owner, one, two] = clients;
    await bootstrap(sql => owner.query(sql));
    await Promise.all(clients.map(db => db.query(login(1))));
    const { rows: [{ id: business }] } = await owner.query("select public.open_business('Test', 'Main') as id");
    const { rows: [{ id: store }] } = await owner.query('select id from public.stores');
    const { rows: [{ id: product }] } = await owner.query("insert into public.products(business_id,name,barcode,price) values ($1,'Tea','001',5000) returning id", [business]);
    await owner.query("select public.adjust_stock($1,$2,$3,2,'Initial')", [business, store, product]);
    await owner.query('select public.change_shift($1,$2,0,false)', [business, store]);
    const checkout = (db, request) => db.query('select public.checkout($1,$2,$3,$4,5000,0,0,5000) as id', [
      business, store, request, JSON.stringify([{ product_id: product, quantity: 1 }]),
    ]);
    const request = n => '00000000-0000-0000-0000-00000000000' + n;
    const duplicate = await Promise.all([checkout(one, request(5)), checkout(two, request(5))]);
    assert.deepEqual(duplicate[0].rows, duplicate[1].rows);
    const competition = await Promise.allSettled([checkout(one, request(6)), checkout(two, request(7))]);
    assert.equal(competition.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(competition.find(result => result.status === 'rejected').reason.message, /insufficient stock/);
    assert.equal((await owner.query('select quantity from public.stock')).rows[0].quantity, '0.000');
    assert.equal((await owner.query('select count(*)::int as n from public.sales')).rows[0].n, 2);
    await owner.query('reset role');
    await owner.query("update public.subscriptions set plan='START',paid_until=now()+interval '1 month' where business_id=$1", [business]);
    await owner.query(login(1));
    const { rows: [{ id: buyer }] } = await owner.query(
      "insert into public.contacts(business_id,kind,name) values($1,'customer','Synthetic') returning id", [business]);
    const { rows: [{ id: debt }] } = await owner.query(
      "select public.write_debt($1,$2,1000,'initial',$3,current_date,null) id", [business, request(8), buyer]);
    const repay = db => db.query("select public.write_debt($1,gen_random_uuid(),700,'repayment',null,null,$2)", [business, debt]);
    const repayments = await Promise.allSettled([repay(one), repay(two)]);
    assert.equal(repayments.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(repayments.find(result => result.status === 'rejected').reason.message, /exceeds balance/);
    const { rows: [{ ledger }] } = await owner.query("select public.debt_overview($1,'','all',0) ledger", [business]);
    assert.equal(ledger.total, '300');
  } finally {
    await Promise.all(clients.map(db => db.end()));
  }
});
