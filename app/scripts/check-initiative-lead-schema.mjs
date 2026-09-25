// Offline check for migration 018. Run from app/: node scripts/check-initiative-lead-schema.mjs
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

const ids = {
  research: '00000000-0000-4000-8000-000000000011',
  lead: '00000000-0000-4000-8000-000000000012',
  member: '00000000-0000-4000-8000-000000000013',
  pending: '00000000-0000-4000-8000-000000000014',
}
for (const id of Object.values(ids)) await db.query('insert into auth.users(id) values($1)', [id])
await db.query('update profiles set account_status=\'approved\' where id<>$1', [ids.pending])
await db.query('insert into role_grants(user_id,role,granted_by) values($1,\'research\',$1)', [ids.research])

async function actor(id) {
  await db.exec('reset role')
  await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)', [id])
  await db.query('select set_config(\'request.jwt.claim.role\',\'authenticated\',false)')
  await db.exec('set role authenticated')
}
async function owner() {
  await db.exec('reset role')
  await db.query('select set_config(\'request.jwt.claim.sub\',\'\',false)')
  await db.query('select set_config(\'request.jwt.claim.role\',\'\',false)')
}
const count = async (sql, params = []) => (await db.query(sql, params)).rows[0].n
const monday = (weeksFromNow) => {
  const day = new Date()
  day.setUTCHours(12, 0, 0, 0)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 7 * weeksFromNow)
  return day.toISOString().slice(0, 10)
}
const pastMonday = monday(-2)
const futureMonday = monday(2)
const unassigned = (await db.query(`insert into initiatives(title,summary,lead_id,lead_name,status,activated_at)
 values('Unassigned project','',null,'Thejo Tattala','active','2025-01-01') returning id`)).rows[0].id
const assigned = (await db.query(`insert into initiatives(title,summary,lead_id,status,activated_at)
 values('Assigned project','',$1,'active','2025-01-01') returning id`, [ids.lead])).rows[0].id
const dormant = (await db.query(`insert into initiatives(title,summary,lead_id,lead_name,status,activated_at)
 values('Stopped project','',null,'Original lead','stopped','2025-01-01') returning id`)).rows[0].id
await db.query('insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,\'lead\')', [assigned, ids.lead])
await db.query('insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,\'member\')', [unassigned, ids.member])
await db.query('insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,\'member\')', [dormant, ids.member])
await assert.rejects(db.query("insert into initiatives(title,lead_name) values('Bad',' padded ')", []), /initiatives_lead_name_valid/)

await actor(ids.research)
await db.query('select open_cycle($1,false)', [pastMonday])
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [unassigned]), 0)
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [assigned]), 2)

await actor(ids.member)
const content = { html: '<p>New work</p>', blocks: [] }
const draft = (await db.query('select save_rm_draft($1,$2,$3,null,null) id', [unassigned, content, pastMonday])).rows[0].id
await assert.rejects(db.query('select submit_rm_draft($1,$2)', [draft, content]), /Assign a lead first/)
await assert.rejects(db.query('select transfer_lead($1,$2)', [unassigned, ids.member]), /research required/)

await owner()
const scheduled = (await db.query('select run_weekly_processing($1) result', [`${futureMonday}T12:05:00Z`])).rows[0].result
assert.equal(scheduled.status, 'ok')
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [unassigned]), 0)
assert.equal(await count('select count(*)::int n from hp_events where initiative_id=$1', [unassigned]), 0)

await actor(ids.research)
await db.query('select evaluate_due_obligations()')
assert.equal(await count('select count(*)::int n from hp_events where initiative_id=$1', [unassigned]), 0)
await assert.rejects(db.query('select transfer_lead($1,$2)', [unassigned, ids.pending]), /approved account/)
await db.query('select transfer_lead($1,$2)', [unassigned, ids.lead])
const updated = (await db.query('select lead_id,lead_name,activated_at from initiatives where id=$1', [unassigned])).rows[0]
assert.equal(updated.lead_id, ids.lead)
assert.equal(updated.lead_name, 'Thejo Tattala')
assert.ok(new Date(updated.activated_at) > new Date('2025-01-01'))
assert.equal(await count("select count(*)::int n from initiative_memberships where initiative_id=$1 and user_id=$2 and role='lead' and left_at is null", [unassigned, ids.lead]), 1)
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [unassigned]), 0)
await db.query('select open_cycle($1,false)', [futureMonday])
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [unassigned]), 2)
await db.query('select transfer_lead($1,$2)', [dormant, ids.member])
assert.equal(await count("select count(*)::int n from initiative_memberships where initiative_id=$1 and user_id=$2 and role='lead' and left_at is null", [dormant, ids.member]), 1)
assert.equal((await db.query('select lead_name from initiatives where id=$1', [dormant])).rows[0].lead_name, 'Original lead')
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [dormant]), 0)

await db.close()
console.log('PASS: text lead, null-lead cycle/penalty skips, explicit first assignment, and later normal obligations.')
