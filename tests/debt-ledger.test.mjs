import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login } from './bootstrap.mjs';

test('debt ledger scopes records, replays exactly and rejects overpayment', async () => {
 const db=new PGlite();
 try {
  await bootstrap(sql=>db.exec(sql));
  await db.exec(login(1));
  const {rows:[{id:business}]}=await db.query("select public.open_business('Debt test','Main') id");
  const {rows:[{id:customer}]}=await db.query("insert into public.contacts(business_id,kind,name) values($1,'customer','Synthetic Buyer') returning id",[business]);
  const opener='10000000-0000-0000-0000-000000000001';
  const payer='10000000-0000-0000-0000-000000000002';
  const open=()=>db.query("select public.write_debt($1,$2,1000,'opening',$3,current_date-2,null) id",[business,opener,customer]);
  await db.exec('reset role');
  await db.query("update public.subscriptions set plan='START',paid_until=now()+interval '1 day' where business_id=$1",[business]);
  await db.exec(login(1));
  const {rows:[{id}]}=await open();
  assert.equal((await open()).rows[0].id,id);
  const repay=(amount,request=payer)=>db.query("select public.write_debt($1,$2,$3,'received',null,null,$4)",[business,request,amount,id]);
  await repay(400);
  await repay(400);
  await assert.rejects(repay(300),/request mismatch/);
  await assert.rejects(repay(601,'10000000-0000-0000-0000-000000000003'),/exceeds balance/);
  const {rows:[{ledger}]}=await db.query("select public.debt_overview($1,'Synthetic','overdue',0) ledger",[business]);
  assert.equal(ledger.total,'600');
  assert.equal(ledger.count,1);
  assert.equal(ledger.rows.length,1);
  await repay(600,'10000000-0000-0000-0000-000000000004');
  const history=(await db.query('select public.debt_history($1,$2,0) history',[business,id])).rows[0].history;
  assert.equal(history.length,3);
  await assert.rejects(db.query('delete from commerce_private.debt_entries'),/permission denied/);
  await db.exec(login(2));
  await assert.rejects(db.query("select public.debt_overview($1,'','all',0)",[business]),/permission denied/);
  await assert.rejects(repay(1),/permission denied/);
 } finally { await db.close(); }
});
