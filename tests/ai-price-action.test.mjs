import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('price proposals require confirmation and retain cancelled, expired and stale states', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql=>db.exec(sql));
    await db.exec(login(1));
    const {rows:[{id: business}]} = await db.query("select public.open_business('Synthetic AI','Main') id");
    const {rows:[{id: product}]} = await db.query("insert into public.products(business_id,name,barcode,price) values($1,'Tea','ABC',100) returning id",[business]);
    const {rows:[{chat}]} = await db.query("select public.ai_conversations($1,'create',null,'Chat')->>'id' chat",[business]);
    const submit = async price => {
      await db.exec('set role service_role');
      const {rows:[{id}]} = await db.query("select public.record_ai_turn($1,$2,$3,'Change the price','Review this','gemini-3.1-flash-lite',100,20,true) id",[business,user(1),chat]);
      assert.equal((await db.query("select public.propose_ai_price($1,'Tea',$2) proposed",[id,price])).rows[0].proposed,true);
      await db.exec(login(1));
      return id;
    };
    const action = (id,operation) => db.query("select public.ai_price_action($1,$2,$3) result",[business,id,operation]);
    const first = await submit(200);
    const second = await submit(300);
    const getPrice = async () => (await db.query("select price from public.products where id=$1",[product])).rows[0].price;
    assert.equal(await getPrice(),100);
    await db.exec(login(2));
    await assert.rejects(action(first,'confirm'),/permission denied/);
    await db.exec(login(1));
    await action(first,'confirm');
    await action(first,'confirm');
    assert.equal(await getPrice(),200);
    assert.equal((await db.query("select count(*)::int n from public.audit_log where action='ai.price.confirm'")).rows[0].n,1);
    await assert.rejects(action(second,'confirm'),/product changed/);
    await action(second,'cancel');
    await assert.rejects(action(second,'confirm'),/proposal unavailable/);
    const expired = await submit(500);
    await db.exec('reset role');
    await db.query("update commerce_private.ai_pending_prices set expires_at=now()-interval '1 second' where id=$1",[expired]);
    await db.exec(login(1));
    await assert.rejects(action(expired,'confirm'),/proposal expired/);
    assert.equal(await getPrice(),200);
  } finally { await db.close(); }
});
