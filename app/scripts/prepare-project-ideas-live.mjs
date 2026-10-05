// Generates private administrator setup/cleanup SQL; never connects to production.
// Passwords and generated SQL stay in the git-ignored smoke-private directory.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const quote = value => `'${String(value).replaceAll("'", "''")}'`
export function createFixture(email, password = null) {
  assert.match(email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Provide the designated disposable member email')
  const run = randomBytes(8).toString('hex')
  const account = role => ({id:randomUUID(), email:`openlabs-${role.toLowerCase()}-${run}@example.invalid`, password:randomBytes(24).toString('base64url'), name:`Smoke ${role} ${run}`})
  return {version:1, run, member:{email:email.toLowerCase(), password:password ?? randomBytes(24).toString('base64url')}, temporaryPassword:password === null,
    research:account('Research'), applicant:account('Applicant'), titles:[`Smoke ${run}: project idea`, `Smoke ${run}: own initiative`]}
}

export async function hashFixturePasswords(f) {
  // Use real pgcrypto locally so hosted setup has no crypto-extension dependency.
  // Check every bcrypt hash against its password before putting it in the SQL.
  const db=new PGlite({extensions:{pgcrypto}})
  try {
    await db.exec('create extension pgcrypto;')
    for(const account of [f.research,f.applicant,...(f.temporaryPassword?[f.member]:[])]) {
      const {rows}=await db.query("select crypt($1,gen_salt('bf',10)) as hash",[account.password])
      const hash=rows[0].hash
      assert.ok(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/.test(hash),'Local bcrypt generation failed')
      assert.ok((await db.query('select crypt($1,$2)=$2 as ok',[account.password,hash])).rows[0].ok,'Local bcrypt verification failed')
      assert.equal((await db.query('select crypt($1,$2)=$2 as ok',[account.password+'-incorrect',hash])).rows[0].ok,false,'Wrong passwords must not verify')
      account.passwordHash=hash
    }
    return f
  } finally {await db.close()}
}

export function setupSql(f) {
  for(const account of [f.research,f.applicant,...(f.temporaryPassword?[f.member]:[])]) {
    assert.ok(/^\$2[aby]\$10\$[./A-Za-z0-9]{53}$/.test(account.passwordHash??''),'Generate verified local password hashes before creating SQL')
  }
  const accounts = [f.research, f.applicant].map(a => `
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change_token_current,email_change_token_new,email_change,
    phone_change,phone_change_token,reauthentication_token,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('00000000-0000-0000-0000-000000000000',${quote(a.id)},'authenticated','authenticated',${quote(a.email)},
    ${quote(a.passwordHash)},now(),'','','','','','','','',
    '{"provider":"email","providers":["email"]}',jsonb_build_object('display_name',${quote(a.name)}),now(),now());
  insert into auth.identities(id,provider_id,user_id,identity_data,provider,created_at,updated_at)
  values(gen_random_uuid(),${quote(a.id)},${quote(a.id)},jsonb_build_object('sub',${quote(a.id)},'email',${quote(a.email)},'email_verified',true),'email',now(),now());`).join('\n')
  return `-- PRIVATE: disposable project-ideas smoke setup ${f.run}.
-- Run once in this project's Supabase SQL Editor as the database administrator.
-- Existing member email: ${f.member.email}. Cleanup restores any changed password/status.
-- Creates two confirmed, password-only fixtures; sends no email.
-- Password hashes were generated and verified locally. No hosted pgcrypto calls.
begin;
create schema if not exists openlabs_smoke_private;
revoke all on schema openlabs_smoke_private from public,anon,authenticated;
create table if not exists openlabs_smoke_private.project_idea_runs (
  run text primary key, member_id uuid not null, research_id uuid not null, applicant_id uuid not null,
  auth_before jsonb not null, profile_before jsonb not null, temporary_password boolean not null,
  titles text[] not null, created_at timestamptz not null default now(), cleaned_at timestamptz
);
revoke all on openlabs_smoke_private.project_idea_runs from public,anon,authenticated;
do $smoke$
declare member_id uuid; prior_auth jsonb; prior_profile jsonb;
begin
  if exists(select 1 from openlabs_smoke_private.project_idea_runs where run=${quote(f.run)}) then
    raise notice 'This smoke setup was already applied'; return;
  end if;
  select id,to_jsonb(u) into member_id,prior_auth from auth.users u where lower(email)=${quote(f.member.email)} and not coalesce(is_sso_user,false) for update;
  if not found then raise exception 'Designated disposable member account does not exist'; end if;
  if exists(select 1 from openlabs_smoke_private.project_idea_runs r where r.member_id=(prior_auth->>'id')::uuid and r.cleaned_at is null) then
    raise exception 'An unfinished smoke run already uses this account';
  end if;
  select to_jsonb(p) into prior_profile from public.profiles p where id=member_id for update;
  if not found then raise exception 'Disposable account profile is missing'; end if;
  if prior_profile->>'account_status' in ('suspended','rejected') or (prior_auth->>'banned_until')::timestamptz>now() then
    raise exception 'Use a disposable account in good standing';
  end if;
  if exists(select 1 from public.role_grants where user_id=member_id and role in ('research','admin') and revoked_at is null) then
    raise exception 'Use a disposable member without Research or administrator privileges';
  end if;
  if not exists(select 1 from auth.identities where user_id=member_id and provider='email') then
    raise exception 'Disposable member requires an email identity';
  end if;
  if exists(select 1 from auth.mfa_factors where user_id=member_id and status='verified') then
    raise exception 'Use a disposable account without enrolled MFA';
  end if;
  insert into openlabs_smoke_private.project_idea_runs(run,member_id,research_id,applicant_id,auth_before,profile_before,temporary_password,titles)
    values(${quote(f.run)},member_id,${quote(f.research.id)},${quote(f.applicant.id)},
      jsonb_build_object('encrypted_password',prior_auth->'encrypted_password','email_confirmed_at',prior_auth->'email_confirmed_at','updated_at',prior_auth->'updated_at'),
      jsonb_build_object('account_status',prior_profile->'account_status','decision_reason',prior_profile->'decision_reason','decided_by',prior_profile->'decided_by','decided_at',prior_profile->'decided_at','updated_at',prior_profile->'updated_at'),
      ${f.temporaryPassword},array[${f.titles.map(quote).join(',')}]);
${accounts}
${f.temporaryPassword ? `  update auth.users set encrypted_password=${quote(f.member.passwordHash)},email_confirmed_at=coalesce(email_confirmed_at,now()),updated_at=now() where id=member_id;` : ''}
  update public.profiles set account_status='approved',decision_reason=${quote(`Disposable smoke ${f.run}`)},decided_at=now(),updated_at=now()
    where id in (member_id,${quote(f.research.id)}::uuid,${quote(f.applicant.id)}::uuid);
  insert into public.role_grants(user_id,role,granted_by) values(${quote(f.research.id)},'research',member_id);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,detail)
    values(member_id,'smoke_fixture_prepared','profile',${quote(f.research.id)},jsonb_build_object('run',${quote(f.run)}));
end $smoke$;
commit;
select 'Disposable project-ideas setup ready' as result;
`
}

export function cleanupSql(f) {
  return `-- Disposable project-ideas cleanup ${f.run}. Run after the smoke check.
-- Only removes this run's exact titles authored by its designated member.
-- Refuses cleanup if other members applied/joined, or any work/reporting exists.
-- Restores the existing member's password/status and disables both new accounts.
-- Immutable audit history and its referenced account identities are retained.
begin;
do $smoke$
declare r openlabs_smoke_private.project_idea_runs%rowtype; pids uuid[]; iids uuid[]; fixture_ids uuid[];
begin
  select * into r from openlabs_smoke_private.project_idea_runs where run=${quote(f.run)} for update;
  if not found then raise exception 'Smoke setup was not applied'; end if;
  if r.cleaned_at is not null then raise notice 'Smoke run already cleaned'; return; end if;
  fixture_ids:=array[r.member_id,r.research_id,r.applicant_id];
  perform 1 from public.proposals where author_id=r.member_id and title=any(r.titles) for update;
  select coalesce(array_agg(id),'{}'::uuid[]) into pids from public.proposals where author_id=r.member_id and title=any(r.titles);
  perform 1 from public.initiatives where proposal_id=any(pids) for update;
  select coalesce(array_agg(id),'{}'::uuid[]) into iids from public.initiatives where proposal_id=any(pids);
  if exists(select 1 from public.idea_lead_requests where proposal_id=any(pids) and not applicant_id=any(fixture_ids))
    or exists(select 1 from public.initiative_memberships where initiative_id=any(iids) and not user_id=any(fixture_ids))
    or exists(select 1 from public.join_requests where initiative_id=any(iids)) then
    raise exception 'Cleanup stopped: another member interacted with these test projects';
  end if;
  if exists(select 1 from public.obligations where initiative_id=any(iids))
    or exists(select 1 from public.documents where initiative_id=any(iids))
    or exists(select 1 from public.hp_events where initiative_id=any(iids))
    or exists(select 1 from public.tasks where initiative_id=any(iids)) then
    raise exception 'Cleanup stopped: reporting or work exists on these test projects';
  end if;
  if exists(select 1 from public.proposals where author_id in (r.research_id,r.applicant_id))
    or exists(select 1 from public.initiative_memberships where user_id in (r.research_id,r.applicant_id) and not initiative_id=any(iids)) then
    raise exception 'Cleanup stopped: generated accounts were used beyond this smoke run';
  end if;
  if (select decision_reason from public.profiles where id=r.member_id) is distinct from ${quote(`Disposable smoke ${f.run}`)} then
    raise exception 'Cleanup stopped: the member standing was changed outside this smoke run';
  end if;
  delete from public.notifications where user_id=any(fixture_ids) and
    ((payload->>'proposal_id')=any(pids::text[]) or (payload->>'initiative_id')=any(iids::text[]));
  delete from public.idea_lead_requests where proposal_id=any(pids);
  delete from public.initiatives where id=any(iids);
  delete from public.proposals where id=any(pids);
  update public.profiles set account_status=(r.profile_before->>'account_status')::public.account_status,
    decision_reason=r.profile_before->>'decision_reason',decided_by=(r.profile_before->>'decided_by')::uuid,
    decided_at=(r.profile_before->>'decided_at')::timestamptz,updated_at=(r.profile_before->>'updated_at')::timestamptz where id=r.member_id;
  if r.temporary_password then
    update auth.users set encrypted_password=r.auth_before->>'encrypted_password',email_confirmed_at=(r.auth_before->>'email_confirmed_at')::timestamptz,
      updated_at=(r.auth_before->>'updated_at')::timestamptz where id=r.member_id;
  end if;
  update public.role_grants set revoked_at=now(),revoked_by=r.member_id where user_id=r.research_id and revoked_at is null;
  update public.profiles set account_status='suspended',decision_reason='Disposable smoke completed',updated_at=now() where id in (r.research_id,r.applicant_id);
  update auth.users set encrypted_password='',banned_until='2999-12-31',updated_at=now() where id in (r.research_id,r.applicant_id);
  delete from auth.sessions where user_id in (r.research_id,r.applicant_id);
  -- Wipe backup credentials after restoring them. Preserve the run marker for retry safety.
  update openlabs_smoke_private.project_idea_runs set auth_before='{}',profile_before='{}',cleaned_at=now() where run=r.run;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,detail)
    values(r.member_id,'smoke_fixture_cleaned','profile',r.research_id,jsonb_build_object('run',r.run));
end $smoke$;
commit;
select 'Disposable project-ideas smoke cleaned' as result;
`
}

export function readPublicConfig() {
  const env={...process.env}
  try {
    for(const line of readFileSync(new URL('../.env.local',import.meta.url),'utf8').split(/\r?\n/)) {
      const m=line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
      if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2')
    }
  } catch { /* CI can provide the frontend environment. */ }
  const base=env.VITE_SUPABASE_URL, key=env.VITE_SUPABASE_ANON_KEY
  assert.ok(base&&key,'Frontend Supabase configuration is required')
  const url=new URL(base)
  assert.ok(url.protocol==='https:'&&!url.username&&!url.password,'Use the HTTPS project base URL')
  if(!key.startsWith('sb_publishable_')) {
    assert.equal(key.split('.').length,3,'Use the frontend public key')
    assert.equal(JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role,'anon','Use the frontend anon key')
  }
  return {base:base.replace(/\/$/,''),key}
}

async function prepare() {
  const args=process.argv.slice(2), email=args[args.indexOf('--member-email')+1]
  assert.ok(args.includes('--member-email')&&email,'Usage: --member-email <disposable email> (--temporary-password | --password-file <private file>)')
  assert.equal(Number(args.includes('--temporary-password'))+Number(args.includes('--password-file')),1,'Choose a temporary password or an existing password file')
  const password=args.includes('--password-file')?readFileSync(resolve(args[args.indexOf('--password-file')+1]),'utf8').trim():null
  if(password!==null)assert.ok(password,'Password file must contain an existing password')
  const f=await hashFixturePasswords({...createFixture(email,password),...readPublicConfig()})
  const dir=join(fileURLToPath(new URL('../../smoke-private/',import.meta.url)),`project-ideas-${f.run}`)
  mkdirSync(dir,{recursive:true})
  for(const [name,body] of [['fixture.json',JSON.stringify(f,null,2)],['setup.sql',setupSql(f)],['cleanup.sql',cleanupSql(f)]])writeFileSync(join(dir,name),body,{mode:0o600,flag:'wx'})
  console.log(`Private setup: ${join(dir,'setup.sql')}\nPrivate fixture: ${join(dir,'fixture.json')}\nCleanup: ${join(dir,'cleanup.sql')}`)
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  // PGlite errors can include query parameters. Print only the message.
  prepare().catch(error=>{console.error(`FAIL: ${error.message}`);process.exitCode=1})
}
