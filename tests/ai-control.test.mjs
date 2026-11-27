import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('AI Control requires AAL2 SUPER_ADMIN and reserves money under the daily cap', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql=>db.exec(sql));
    await db.exec(login(1));
    const {rows:[{id:business}]}=await db.query("select public.open_business('Synthetic','Main') id");
    await db.exec(`reset role; update auth.users set email_confirmed_at=now() where id='${user(2)}';
      insert into commerce_private.platform_admins(user_id,role) values('${user(2)}','SUPER_ADMIN'); ${login(2)}`);
    await assert.rejects(db.query('select public.control_ai()'),/permission denied/);
    await db.exec(`set request.jwt.claims='{"aal":"aal2"}'; ${login(1)}`);
    await assert.rejects(db.query('select public.control_ai()'),/permission denied/);
    await db.exec(login(2));
    await db.query("select public.control_ai('budget',2000)");
    await db.query("select public.control_ai('pilot',1,$1)",[business]);
    await db.exec(login(1));
    assert.equal((await db.query('select public.ai_remaining($1) quota',[business])).rows[0].quota.remaining,1);
    await db.query('select public.ai_context($1)',[business]);
    await assert.rejects(db.query('select public.ai_context($1)',[business]),/AI disabled/);
    const reserve = () => db.query("select public.reserve_ai_budget('gemini-3.1-flash-lite',100,1200) reserved");
    await assert.rejects(reserve(),/permission denied/);
    await db.exec('set role service_role');
    assert.equal((await reserve()).rows[0].reserved,true);
    assert.equal((await reserve()).rows[0].reserved,false);
    await db.exec(login(2));
    await db.query("select public.control_ai('stop')");
    await assert.rejects(db.query("select public.control_ai('enable')"),/positive limits required/);
    const state = (await db.query('select public.control_ai() state')).rows[0].state;
    assert.equal(state.enabled,false);
    assert.equal(state.reserved,1825);
  } finally { await db.close(); }
});
