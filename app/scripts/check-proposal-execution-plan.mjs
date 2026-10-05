// Offline approval migration check. Never connects to a hosted database.
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
for (const file of readdirSync('../supabase/migrations').filter(x => x.endsWith('.sql') && x < '202610030025_proposal_execution_plan.sql').sort()) {
  await db.exec(readFileSync('../supabase/migrations/' + file, 'utf8').replace('create extension if not exists pgcrypto;', ''))
}

const research='00000000-0000-4000-8000-000000000021'
const member='00000000-0000-4000-8000-000000000022'
for(const id of [research,member])await db.query('insert into auth.users(id) values($1)',[id])
await db.exec("update profiles set account_status='approved'")
await db.query("insert into role_grants(user_id,role,granted_by) values($1,'research',$1)",[research])
const historical=(await db.query("insert into initiatives(title,summary,content,lead_id) values('Legacy','Legacy summary',$1,$2) returning id,summary,content",[{html:'<p>Imported rich overview</p>',abstract_html:'<p>Rich abstract</p>',motivation:'Original motivation'},member])).rows[0]
const columns=(await db.query("select column_name from information_schema.columns where table_name='initiative_catalog' order by ordinal_position")).rows.map(r=>r.column_name)
await db.exec(readFileSync('../supabase/migrations/202610030025_proposal_execution_plan.sql','utf8'))
assert.deepEqual((await db.query('select id,summary,content from initiatives where id=$1',[historical.id])).rows[0],historical)
assert.deepEqual((await db.query("select column_name from information_schema.columns where table_name='initiative_catalog' order by ordinal_position")).rows.map(r=>r.column_name),[...columns,'execution_plan'])
const actor=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated')}
const abstract='Distinct abstract: investigate perception with a focused student experiment.'
const plan='Distinct plan: recruit the team.\n\nPilot in week two; analyze in week three.'
const content={html:plan,abstract_html:'<p>Distinct rich abstract</p>',category:'Research',motivation:Array(151).fill('reason').join(' ')}
await actor(member)
const proposal=(await db.query('select save_proposal($1,$2,$3,true) id',['Distinct project',abstract,content])).rows[0].id
await assert.rejects(db.query("select decide_proposal($1,'approved','')",[proposal]),/research required/)
await actor(research)
const iid=(await db.query("select decide_proposal($1,'approved','Approved') id",[proposal])).rows[0].id
const row=(await db.query('select summary,content from initiatives where id=$1',[iid])).rows[0]
assert.equal(row.summary,abstract);assert.equal(row.content.execution_plan,plan);assert.equal(row.content.html,'')
assert.equal(row.content.abstract_from_overview,true);assert.equal(row.content.abstract_html,content.abstract_html)
assert.equal(row.content.motivation,content.motivation)
assert.equal((await db.query("select decide_proposal($1,'approved','Again') id",[proposal])).rows[0].id,iid)
await db.exec('reset role')
assert.equal((await db.query('select count(*)::int n from initiatives where proposal_id=$1',[proposal])).rows[0].n,1)
assert.equal((await db.query("select count(*)::int n from notifications where user_id=$1 and kind='proposal_decided'",[member])).rows[0].n,1)
assert.equal((await db.query("select count(*)::int n from audit_events where action='proposal_decided' and entity_id=$1",[proposal])).rows[0].n,1)
await db.exec('set role anon')
assert.equal((await db.query('select execution_plan from initiative_catalog where id=$1',[iid])).rows[0].execution_plan,plan)
await db.exec('reset role')
await db.exec(readFileSync('../supabase/migrations/202610030025_proposal_execution_plan.sql','utf8'))
await db.close()
console.log('PASS (offline PGlite): separate abstract/plan, rich content and historical preservation, append-only catalog columns, public access, Research authorization, repeat approval, one notification/audit, migration repeat safety.')
