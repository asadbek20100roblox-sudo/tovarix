import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('verified email gets one trial, expiration restores FREE without deletion', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql => db.exec(sql));
    await db.query("update auth.users set email='Synthetic@Example.com',email_confirmed_at=now() where id=$1", [user(1)]);
    await db.query("update auth.users set email='synthetic@example.com',email_confirmed_at=now() where id=$1", [user(2)]);
    await db.exec(login(1));
    const open = name => db.query("select public.open_business_v04($1,'Main','grocery',null,'piece',null) as id", [name]);
    const { rows:[{ id: first }] } = await open('First');
    const { rows:[{ id: second }] } = await open('Second');
    const overview = business => db.query('select public.billing_overview($1) as details',[business]);
    const active = (await overview(first)).rows[0].details;
    assert.equal(active.plan,'PREMIUM');
    assert.equal(new Date(active.trial_until)-new Date(active.trial_started_at),30*86400000);
    assert.equal((await overview(second)).rows[0].details.plan,'FREE');
    await db.query("insert into public.stores(business_id,name) values($1,'Extra')",[first]);
    await assert.rejects(db.query("insert into public.stores(business_id,name) values($1,'Extra')",[second]),/resource limit/);
    await db.query("select public.set_staff($1,$2,'cashier',array['sell'])",[first,user(4)]);
    await db.exec('reset role');
    await db.query("update public.subscriptions set trial_until=now()-interval '1 second' where business_id=$1",[first]);
    await db.exec(login(1));
    assert.equal((await overview(first)).rows[0].details.plan,'FREE');
    assert.equal(Number((await db.query('select count(*) from public.members where business_id=$1',[first])).rows[0].count),1);
    await db.exec(login(2));
    const { rows:[{ id: reused }] } = await open('Reused email');
    assert.equal((await overview(reused)).rows[0].details.trial_started_at,null);
    await db.exec(login(3));
    await assert.rejects(open('Unverified'),/confirmed email/);
    await assert.rejects(overview(first),/permission denied/);
    await db.exec('reset role');
    await db.exec('update commerce_private.platform_settings set ai_enabled=true');
    await db.exec(login(1));
    for (let n=0;n<5;n++) await db.query('select public.ai_context($1)',[first]);
    await assert.rejects(db.query('select public.ai_context($1)',[first]),/AI quota exceeded/);
  } finally { await db.close(); }
});
