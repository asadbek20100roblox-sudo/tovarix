import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { bootstrap, login } from './bootstrap.mjs';

test('credit checkout creates one outgoing sale and debt with zero cash, and settles once',async()=>{
  const db=new PGlite();
  try {
    await bootstrap(sql=>db.exec(sql));
    await db.exec(login(1));
    const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
    const [{id:b}]=await rows("select public.open_business('Synthetic credit','Main') id");
    const [{id:s}]=await rows('select id from public.stores where business_id=$1',[b]);
    const [{id:p}]=await rows("insert into public.products(business_id,name,barcode,price) values($1,'Tea','100',1000) returning id",[b]);
    const [{id:c}]=await rows("insert into public.contacts(business_id,kind,name,phone) values($1,'customer','Buyer','+998900000000') returning id",[b]);
    const [{id:supplier}]=await rows("select public.create_debt_supplier($1,'Supplier') id",[b]);
    await rows("select public.adjust_stock($1,$2,$3,4,'Initial')",[b,s,p]);
    await rows('select public.change_shift($1,$2,0,false)',[b,s]);
    const request='10000000-0000-0000-0000-000000000040';
    const checkout=()=>rows("select public.checkout_on_account($1,$2,$3,$4,0,0,0,1000,$5,current_date) id",[b,s,request,JSON.stringify([{product_id:p,quantity:1}]),c]);
    const first=await checkout();
    assert.deepEqual(await checkout(),first);
    assert.deepEqual(await rows('select total,cash,card,credit from public.sales'),[{total:1000,cash:0,card:0,credit:true}]);
    assert.equal((await rows('select quantity from public.stock'))[0].quantity,'3.000');
    await assert.rejects(rows("select public.return_sale($1,$2,'Wrong refund')",[b,first[0].id]),/receivable reversal/);
    assert.equal((await rows('select quantity from public.stock'))[0].quantity,'3.000');
    const fetch=(kind,search='')=>rows("select public.debt_book($1,$2,$3,'all','balance',0,current_date-30,current_date+1) book",[b,kind,search]).then(x=>x[0].book);
    const [{id:payable}]=await rows("select public.write_debt($1,gen_random_uuid(),600,'Supplier bill',$2,current_date,null) id",[b,supplier]);
    const debt=await fetch('customer','000000');
    assert.equal(debt.total,'1000');
    assert.equal(debt.smart,false);
    assert.equal((await fetch('supplier')).total,'600');
    const debtId=debt.rows[0].id;
    const pay=(method,amount=400)=>rows("select public.record_debt_payment($1,$2,$3,$4,'Received',$5)",[b,'10000000-0000-0000-0000-000000000041',debtId,amount,method]);
    await pay('cash');
    await pay('cash');
    await assert.rejects(pay('transfer'),/request mismatch/);
    assert.equal((await fetch('customer')).total,'600');
    await rows("select public.reschedule_debt($1,$2,current_date,current_date+3)",[b,debtId]);
    await assert.rejects(rows("select public.reschedule_debt($1,$2,current_date,current_date+4)",[b,debtId]),/changed/);
    await rows("select public.cancel_manual_debt($1,$2,'Error creating manual debt')",[b,payable]);
    assert.equal((await fetch('supplier')).rows[0].balance,0);
    await assert.rejects(rows("select public.cancel_manual_debt($1,$2,'Wrong correction')",[b,debtId]),/financial reversal/);
    for(let i=0;i<3;i++){
      const [{id}]=await rows("select public.write_debt($1,gen_random_uuid(),100,'History',$2,current_date-6,null) id",[b,c]);
      await rows("select public.record_debt_payment($1,gen_random_uuid(),$2,100,'Settled','card')",[b,id]);
    }
    assert.equal((await fetch('customer')).rows[0].samples,null);
    await db.exec('reset role');
    await rows("update public.subscriptions set plan='STANDARD',paid_until=now()+interval '1 day' where business_id=$1",[b]);
    await db.exec(login(1));
    const smart=await fetch('customer');
    assert.equal(smart.smart,true);
    assert.equal(smart.rows[0].samples,3);
    assert.equal(smart.rows[0].late,3);
    await db.exec(login(2));
    await assert.rejects(fetch('customer'),/permission denied/);
  } finally { await db.close(); }
});
