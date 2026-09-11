import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated;`)
for (const file of readdirSync('../supabase/migrations').filter(x => x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync('../supabase/migrations/' + file, 'utf8').replace('create extension if not exists pgcrypto;', ''))
}
const approved='00000000-0000-4000-8000-000000000001', pending='00000000-0000-4000-8000-000000000002'
await db.query(`insert into auth.users(id,email) values($1,'approved@example.test'),($2,'pending@example.test')`,[approved,pending])
await db.query(`update public.profiles set account_status='approved' where id=$1`,[approved])
await db.query(`insert into public.historical_imports(source_key,title,payload) values('source-one','First archive',$1)`,[{sections:[]}])
async function actor(id,role){await db.exec('reset role');await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',id??'']);await db.exec(`set role ${role}`)}
await actor(approved,'authenticated')
assert.equal((await db.query('select count(*)::int c from public.historical_imports')).rows[0].c,1)
await assert.rejects(db.query(`insert into public.historical_imports(source_key,title,payload) values('client','Client write',$1)`,[{sections:[]}]))
await actor(pending,'authenticated')
assert.equal((await db.query('select count(*)::int c from public.historical_imports')).rows[0].c,0)
await actor(null,'anon')
await assert.rejects(db.query('select * from public.historical_imports'))
console.log('PASS: historical imports are read-only and visible only to approved accounts.')
