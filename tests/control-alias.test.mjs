import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login, user } from './bootstrap.mjs';

test('CONTROL alias requires service access and a confirmed bound owner, with a bounded attempt window', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql => db.exec(sql));
    const resolve = async () => (await db.query("select public.control_login_target('ADMIN63') email")).rows[0].email;
    await db.exec(login(1));
    await assert.rejects(resolve(), /permission denied/);
    await db.exec('set role service_role');
    assert.equal(await resolve(), null);
    await db.exec(`reset role; update auth.users set email='synthetic@example.com' where id='${user(1)}';
      insert into commerce_private.platform_admins(user_id,role,login_alias) values('${user(1)}','SUPER_ADMIN','ADMIN63');
      set role service_role`);
    assert.equal(await resolve(), null);
    await db.exec(`reset role; update auth.users set email_confirmed_at=now() where id='${user(1)}'; set role service_role`);
    for (let i=0;i<8;i++) assert.equal(await resolve(), 'synthetic@example.com');
    assert.equal(await resolve(), null);
  } finally { await db.close(); }
});
