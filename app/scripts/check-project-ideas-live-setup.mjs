// Executes generated administrator SQL against an offline PostgreSQL fixture.
// Real password hashes are generated locally. Hosted setup needs no pgcrypto.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createFixture, hashFixturePasswords, setupSql, cleanupSql } from './prepare-project-ideas-live.mjs'
process.on('uncaughtException',error=>{console.error(error.message);process.exit(1)})

const db=new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text unique,encrypted_password text,email_confirmed_at timestamptz,
  confirmation_token text,recovery_token text,email_change_token_current text,email_change_token_new text,email_change text,phone_change text,phone_change_token text,reauthentication_token text,
  raw_app_meta_data jsonb,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),is_sso_user boolean default false,banned_until timestamptz);
create table auth.identities(id uuid primary key,provider_id text not null,user_id uuid references auth.users(id),identity_data jsonb,provider text,created_at timestamptz,updated_at timestamptz,unique(provider_id,provider));
create table auth.mfa_factors(id uuid primary key,user_id uuid,status text);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated;`)
const migrations=new URL('../../supabase/migrations/',import.meta.url)
for(const file of readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(new URL(file,migrations),'utf8').replace('create extension if not exists pgcrypto;',''))
const f=await hashFixturePasswords(createFixture('member@example.invalid')), setup=setupSql(f), cleanup=cleanupSql(f)
assert.ok(!/\b(?:crypt|gen_salt|gensalt)\s*\(/i.test(setup),'Hosted SQL must not invoke crypto functions')
for(const account of [f.member,f.research,f.applicant])assert.ok(!setup.includes(account.password),'Hosted SQL must contain hashes rather than plaintext passwords')
const member='00000000-0000-4000-8000-000000000091', outsider='00000000-0000-4000-8000-000000000092'
await db.query("insert into auth.users(id,email,encrypted_password,email_confirmed_at,raw_user_meta_data) values($1,$2,'original-password-hash','2026-09-01', '{\"display_name\":\"Existing member\"}')",[member,f.member.email])
await db.query("insert into auth.identities(id,provider_id,user_id,provider) values(gen_random_uuid(),$1::text,$1::uuid,'email')",[member])
const row=async(sql,args=[])=> (await db.query(sql,args)).rows[0]
const authBefore=await row('select encrypted_password,email_confirmed_at,updated_at from auth.users where id=$1',[member])
const profileBefore=await row('select account_status,decision_reason,decided_by,decided_at,updated_at from profiles where id=$1',[member])
await db.exec(setup)
await db.exec(setup)
assert.equal((await row('select count(*)::int n from auth.users')).n,3)
assert.equal((await row("select count(*)::int n from role_grants where role='research' and revoked_at is null")).n,1)
assert.ok((await row('select encrypted_password from auth.users where id=$1',[member])).encrypted_password===f.member.passwordHash,'Prepared password hash must be stored')
await db.exec('set role anon')
await assert.rejects(db.query('select * from openlabs_smoke_private.project_idea_runs'),/permission denied/)
await db.exec('reset role')
const other=await hashFixturePasswords(createFixture(f.member.email))
await assert.rejects(db.exec(setupSql(other)),/unfinished smoke run/)
await db.exec('rollback')

await db.query("select set_config('request.jwt.claim.sub',$1,false)",[member])
const content={html:'Test plan retained',category:'Research',motivation:Array(151).fill('reason').join(' '),purpose:'project_idea'}
const p=(await row('select save_proposal($1,$2,$3,true) id',[f.titles[0],'Disposable live test abstract',content])).id
const unrelated=(await row('select save_proposal($1,$2,$3,false) id',['Keep this existing proposal','Unrelated content',content])).id
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.research.id])
await db.query("select decide_proposal($1,'approved')",[p])
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.applicant.id])
const request=(await row('select request_idea_lead($1,$2) id',[p,'I have time for this test project.'])).id
await db.query("select set_config('request.jwt.claim.sub',$1,false)",[f.research.id])
const initiative=(await row('select decide_idea_lead($1,true) id',[request])).id
await db.query("insert into auth.users(id,email,raw_user_meta_data) values($1,'outsider@example.invalid','{}')",[outsider])
await db.query('insert into idea_lead_requests(proposal_id,applicant_id,message) values($1,$2,$3)',[p,outsider,'A different member applied.'])
await assert.rejects(db.exec(cleanup),/another member interacted/)
await db.exec('rollback')
assert.equal((await row('select count(*)::int n from initiatives where id=$1',[initiative])).n,1)
await db.query('delete from idea_lead_requests where applicant_id=$1',[outsider])
await db.query("insert into tasks(initiative_id,title,status,created_by) values($1,'Existing work','pending',$2)",[initiative,member])
await assert.rejects(db.exec(cleanup),/reporting or work exists/)
await db.exec('rollback')
await db.query('delete from tasks where initiative_id=$1',[initiative])
await db.exec(cleanup)
await db.exec(cleanup)
assert.deepEqual(await row('select encrypted_password,email_confirmed_at,updated_at from auth.users where id=$1',[member]),authBefore)
assert.deepEqual(await row('select account_status,decision_reason,decided_by,decided_at,updated_at from profiles where id=$1',[member]),profileBefore)
assert.equal((await row('select count(*)::int n from proposals where id=$1',[unrelated])).n,1)
assert.equal((await row('select count(*)::int n from proposals where id=$1',[p])).n,0)
assert.equal((await row('select count(*)::int n from initiatives where id=$1',[initiative])).n,0)
assert.equal((await row('select count(*)::int n from initiative_memberships where initiative_id=$1',[initiative])).n,0)
assert.equal((await row('select count(*)::int n from role_grants where user_id=$1 and revoked_at is null',[f.research.id])).n,0)
assert.equal((await row("select count(*)::int n from profiles where id in ($1,$2) and account_status='suspended'",[f.research.id,f.applicant.id])).n,2)
assert.equal((await row("select count(*)::int n from audit_events where action='smoke_fixture_cleaned'")).n,1)
assert.deepEqual((await row('select auth_before,profile_before from openlabs_smoke_private.project_idea_runs')).auth_before,{})
// Existing-password mode must work without any database crypto functions, too.
const existingPassword=await hashFixturePasswords(createFixture(f.member.email,'existing-password'))
await db.exec(setupSql(existingPassword))
assert.deepEqual(await row('select encrypted_password,email_confirmed_at,updated_at from auth.users where id=$1',[member]),authBefore,'Existing-password mode must not change auth credentials')
await db.exec(cleanupSql(existingPassword))
assert.deepEqual(await row('select encrypted_password,email_confirmed_at,updated_at from auth.users where id=$1',[member]),authBefore)
await db.close()
console.log('PASS (offline PostgreSQL): verified bcrypt hashes, setup without hosted pgcrypto or plaintext passwords, private disposable setup, retry safety, guarded cleanup, preserved unrelated submissions/audit, restored member credentials/standing, revoked fixture Research access.')
