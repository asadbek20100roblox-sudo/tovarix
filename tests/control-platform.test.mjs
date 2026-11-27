import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('CONTROL directory and writes require confirmed AAL2 SUPER_ADMIN',async()=>{
  const db=new PGlite();
  try {
    await bootstrap(sql=>db.exec(sql));
    await db.exec(login(1));
    const {rows:[{id:business}]}=await db.query("select public.open_business('Synthetic Directory','Main') id");
    const area=(section,command=null,payload={})=>db.query("select public.control_platform($1,'',0,$2,$3) result",[section,command,payload]);
    await assert.rejects(area('users'),/permission denied/);
    await db.exec(`reset role; update auth.users set email_confirmed_at=now() where id='${user(2)}';
      insert into commerce_private.platform_admins(user_id,role) values('${user(2)}','SUPER_ADMIN'); ${login(2)}`);
    await assert.rejects(area('dashboard'),/permission denied/);
    await db.exec("set request.jwt.claims='{\"aal\":\"aal2\"}'");
    assert.equal((await area('businesses')).rows[0].result[0].name,'Synthetic Directory');
    await area('subscriptions','grant-plan',{id:business,plan:'PLUS',until:'2099-01-01',reason:'Synthetic grant'}).then(
      ()=>assert.fail('unbounded date'),error=>assert.match(error.message,/invalid subscription/));
    const until=new Date(Date.now()+86400000).toISOString();
    assert.equal((await area('subscriptions','grant-plan',{id:business,plan:'PLUS',until,reason:'Synthetic grant'})).rows[0].result[0].effective_plan,'PLUS');
    await area('notifications','publish',{title:'Maintenance',message:'Synthetic announcement',kind:'maintenance'});
    await area('users','suspend',{id:user(1),reason:'Synthetic security test'});
    assert.equal((await area('users')).rows[0].result.find(row=>row.id===user(1)).banned,true);
    await db.exec(login(1));
    assert.equal((await db.query('select id from public.businesses')).rows.length,0);
    assert.equal((await db.query('select public.platform_announcements() result')).rows[0].result[0].title,'Maintenance');
  } finally { await db.close(); }
});
