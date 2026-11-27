import { readFile, readdir } from 'node:fs/promises';

export const user = index => '00000000-0000-0000-0000-00000000000' + index;
export const login = index => `set role authenticated; set request.jwt.claim.sub = '${user(index)}'`;

export async function bootstrap(execute) {
  await execute(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated;
    insert into auth.users values ('${user(1)}'), ('${user(2)}'), ('${user(3)}'), ('${user(4)}');
  `);
  for (const name of (await readdir('supabase/migrations')).sort()) {
    await execute(await readFile('supabase/migrations/' + name, 'utf8'));
  }
}
