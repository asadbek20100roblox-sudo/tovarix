import { readFile, readdir } from 'node:fs/promises';

export const user = index => '00000000-0000-0000-0000-00000000000' + index;
export const login = index => `set role authenticated; set request.jwt.claim.sub = '${user(index)}'`;

export async function bootstrap(execute) {
  await execute(`
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,invited_at timestamptz,raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as
      'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    create function auth.jwt() returns jsonb language sql stable as
      'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
    grant usage on schema auth to authenticated;
    insert into auth.users(id) values ('${user(1)}'), ('${user(2)}'), ('${user(3)}'), ('${user(4)}');
  `);
  for (const name of (await readdir('supabase/migrations')).sort()) {
    await execute(await readFile('supabase/migrations/' + name, 'utf8'));
  }
}
