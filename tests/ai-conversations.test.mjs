import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login } from './bootstrap.mjs';

test('AI conversation belongs to the caller and deletion removes it from their history', async () => {
  const db = new PGlite();
  try {
    await bootstrap(sql => db.exec(sql));
    await db.exec(login(1));
    const { rows: [{ id: business }] } = await db.query("select public.open_business('Synthetic AI','Main') id");
    const chat = (action,id=null,title=null) => db.query('select public.ai_conversations($1,$2,$3,$4) result',[business,action,id,title]);
    const id = (await chat('create',null,'Test')).rows[0].result.id;
    await chat('rename',id,'Renamed');
    assert.equal((await chat('list')).rows[0].result[0].title,'Renamed');
    await db.exec(login(2));
    await assert.rejects(chat('delete',id),/permission denied/);
    await db.exec(login(1));
    await chat('delete',id);
    assert.deepEqual((await chat('list')).rows[0].result,[]);
  } finally { await db.close(); }
});
