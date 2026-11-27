import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('manual subscriptions require confirmed AAL2 authority and activate exactly once', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql => db.exec(sql));
    await db.exec(login(1));
    const { rows: [{ id: business }] } = await db.query("select public.open_business('Synthetic subscription','Main') id");
    const create = async () => (await db.query("select public.manage_manual_subscription($1,'create',$2,'PLUS',12) result",
      [business, '10000000-0000-0000-0000-000000000005'])).rows[0].result;
    const first = await create();
    assert.equal((await create()).created, first.created);
    assert.equal(first.rows[0].amount_uzs, 2599000);
    assert.equal(first.rows[0].status, 'PENDING');
    assert.equal((await db.query('select plan from public.subscriptions')).rows[0].plan, 'FREE');
    const transition = (action, evidence = null) => db.query('select public.manage_manual_subscription(null,$1,$2,null,null,$3)', [action, first.created, evidence]);
    await assert.rejects(transition('CONTACTED'), /permission denied/);
    await db.exec(`reset role; insert into commerce_private.platform_admins values('${user(2)}','SUPER_ADMIN'); ${login(2)}`);
    await assert.rejects(transition('CONTACTED'), /permission denied/);
    await db.exec(`set request.jwt.claims='{"aal":"aal2"}'`);
    await assert.rejects(transition('CONTACTED'), /permission denied/);
    await db.exec(`reset role; update auth.users set email_confirmed_at=now() where id='${user(2)}'; ${login(2)}`);
    await assert.rejects(transition('ACTIVATED'), /invalid transition/);
    await transition('CONTACTED');
    await transition('AWAITING_PAYMENT');
    await assert.rejects(transition('PAYMENT_VERIFIED'), /payment reference required/);
    await transition('PAYMENT_VERIFIED', 'synthetic-receipt-42');
    await assert.rejects(transition('PAYMENT_VERIFIED', 'wrong-receipt'), /invalid transition/);
    await transition('ACTIVATED');
    await db.exec(login(1));
    const paid = (await db.query('select plan,paid_until from public.subscriptions')).rows[0];
    assert.equal(paid.plan, 'PLUS');
    await db.exec(login(2));
    await transition('ACTIVATED');
    await db.exec(login(1));
    assert.deepEqual((await db.query('select plan,paid_until from public.subscriptions')).rows[0], paid);
  } finally { await db.close(); }
});
