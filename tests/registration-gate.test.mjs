import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap } from './bootstrap.mjs';

test('public registration fails closed and a server invitation can create an account', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql=>db.exec(sql));
    await db.exec('set role anon');
    assert.equal((await db.query('select public.registration_open() enabled')).rows[0].enabled,false);
    await db.exec('reset role');
    const id='b43a87db-4971-4813-8e54-0ee126da0000';
    await assert.rejects(db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,'{"invited_at":"2026-11-27"}']),/invitation only/);
    await db.query('insert into auth.users(id,invited_at) values($1,now())',[id]);
    assert.equal((await db.query('select count(*)::int count from auth.users where id=$1',[id])).rows[0].count,1);
  } finally { await db.close(); }
});
