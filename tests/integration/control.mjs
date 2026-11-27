import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

function totp(seed) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...seed].map(char => alphabet.indexOf(char).toString(2).padStart(5,'0')).join('');
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => Number.parseInt(byte,2)));
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30_000)));
  const result = createHmac('sha1',key).update(time).digest();
  const digits = (result.readUInt32BE(result.at(-1)&15)&0x7fff_ffff)%1_000_000;
  return String(digits).padStart(6,'0');
}

test('synthetic alias authenticates through GoTrue and CONTROL opens only after TOTP', { timeout: 40000 }, async () => {
  const { TOVARIX_TEST_WEB: base,TOVARIX_TEST_CONTROL: edge,TOVARIX_TEST_ANON: key,TOVARIX_TEST_CONTROL_DB: connectionString } = process.env;
  assert.ok(base && edge && key && connectionString, 'Use a disposable Supabase Auth/Data API and PostgreSQL');
  const db = new pg.Client({connectionString});
  await db.connect();
  const client = createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const nonce = randomUUID().slice(0,8);
  const email = 'control-'+nonce+'@example.com';
  const alias = 'TEST'+nonce.toUpperCase();
  const password = 'Disposable-Password!'+randomUUID();
  let uid;
  const login = (value, pass) => fetch(edge,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:value,password:pass})});
  try {
    const created = await client.auth.signUp({email,password});
    assert.ifError(created.error);
    assert.ok(created.data.session, 'Enable AutoConfirm only on this disposable GoTrue instance');
    uid=created.data.user.id;
    await db.query("insert into commerce_private.platform_admins(user_id,role,login_alias) values($1,'SUPER_ADMIN',$2)",[uid,alias]);
    const denial = await login(alias,'wrong-password');
    const missing = await login('DOESNOTEXIST','wrong-password');
    assert.equal(denial.status,401);
    assert.equal(missing.status,401);
    assert.equal(await denial.text(),await missing.text());
    const signedIn = await login(alias,password);
    assert.equal(signedIn.status,200);
    const tokens = await signedIn.json();
    assert.deepEqual(Object.keys(tokens).sort(),['access_token','refresh_token']);
    const established = await client.auth.setSession(tokens);
    assert.ifError(established.error);
    assert.equal((await client.rpc('control_ai')).error.code,'42501');
    assert.equal((await client.rpc('control_platform',{p_area:'dashboard'})).error.code,'42501');
    const enrolled = await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Disposable test'});
    assert.ifError(enrolled.error);
    const verified = await client.auth.mfa.challengeAndVerify({factorId:enrolled.data.id,code:totp(enrolled.data.totp.secret)});
    assert.ifError(verified.error);
    assert.equal((await client.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel,'aal2');
    assert.ifError((await client.rpc('control_ai')).error);
    const dashboard=await client.rpc('control_platform',{p_area:'dashboard'});
    assert.ifError(dashboard.error);
    assert.equal(typeof dashboard.data.users,'number');
    assert.equal((await db.query("select count(*)::int n from commerce_private.platform_audit where actor=$1 and action='control.password.verified'",[uid])).rows[0].n,1);
    assert.ifError((await client.auth.signOut({scope:'global'})).error);
    assert.equal((await client.auth.getSession()).data.session,null);
  } finally {
    if(uid) {
      await db.query('delete from commerce_private.platform_audit where actor=$1',[uid]);
      await db.query('delete from commerce_private.platform_admins where user_id=$1',[uid]);
      await db.query('delete from auth.users where id=$1 and email=$2',[uid,email]);
    }
    await db.end();
  }
});
