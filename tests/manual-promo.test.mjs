import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('manual subscription applies a scoped promo once per account and keeps the approved catalogue',async()=>{
  const db=new PGlite();
  try {
    await bootstrap(sql=>db.exec(sql));
    await db.exec(login(1));
    const {rows:[{id:business}]}=await db.query("select public.open_business('Synthetic promo','Main') id");
    await db.exec(`reset role; update auth.users set email_confirmed_at=now() where id='${user(2)}';
      insert into commerce_private.platform_admins(user_id,role) values('${user(2)}','SUPER_ADMIN'); ${login(2)}
      ; set request.jwt.claims='{"aal":"aal2"}'`);
    const issue=(code)=>db.query("select public.control_promos('issue',$1,'START',10,now()+interval '2 days')",[code]);
    await issue('PROMO001');
    await issue('PROMO002');
    await assert.rejects(issue('PROMO003'),/monthly promo limit/);
    await db.exec(login(1));
    const create=(plan,id)=>db.query("select public.manage_manual_subscription($1,'create',$2,$3,1,'PROMO001') result",[business,id,plan]);
    const id='10000000-0000-0000-0000-000000000030';
    await assert.rejects(create('PLUS',id),/promo unavailable/);
    const first=(await create('START',id)).rows[0].result;
    assert.equal(first.rows[0].amount_uzs,35100);
    assert.equal((await create('START',id)).rows[0].result.created,first.created);
    await assert.rejects(create('START','10000000-0000-0000-0000-000000000031'),/subscription_request_promo_unique/);
    await db.exec(login(2));
    const {rows:[{result}]}=await db.query("select public.control_promos() result");
    assert.equal(result.find(item=>item.code==='PROMO001').use_count,1);
  } finally {await db.close();}
});
