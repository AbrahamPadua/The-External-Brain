// Offline Progress review workflow. Run from app/.
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
  research: '00000000-0000-4000-8000-000000000021',
  lead: '00000000-0000-4000-8000-000000000022',
  member: '00000000-0000-4000-8000-000000000023',
  pending: '00000000-0000-4000-8000-000000000024',
  operations: '00000000-0000-4000-8000-000000000025',
}
for (const id of Object.values(ids)) await db.query('insert into auth.users(id) values($1)', [id])
await db.query('update profiles set account_status=\'approved\' where id<>$1', [ids.pending])
await db.query('insert into role_grants(user_id,role,granted_by) values($1,\'research\',$1)', [ids.research])
await db.query('insert into role_grants(user_id,role,granted_by) values($1,\'operations\',$1)', [ids.operations])
const actor = async id => {
  await db.exec('reset role')
  await db.query('select set_config(\'request.jwt.claim.sub\',$1,false)', [id])
  await db.query('select set_config(\'request.jwt.claim.role\',\'authenticated\',false)')
  await db.exec('set role authenticated')
}
const owner = async () => {
  await db.exec('reset role')
  await db.query('select set_config(\'request.jwt.claim.sub\',\'\',false)')
  await db.query('select set_config(\'request.jwt.claim.role\',\'\',false)')
}
const val = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const iid = (await val(`insert into initiatives(title,summary,lead_id) values('Review target','A project that accepts member feedback',$1) returning id`, [ids.lead])).id
await db.query('insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,\'member\')', [iid, ids.member])
const target = (await val(`insert into documents(kind,initiative_id,is_historical_import,historical_source_key,submitted_version_number)
 values('rm',$1,true,'progress-test',1) returning id`, [iid])).id
await db.query(`insert into document_versions(document_id,version_number,content) values($1,1,$2::jsonb)`, [target, JSON.stringify({blocks:[],html:'<p>Published progress</p>',title:'Target RM',historical:true,source_key:'progress-test',source_author:'Source author',source_period:null,source_week:'Week 1',source_record_count:1})])
const draft = (await val(`insert into documents(kind,initiative_id,author_id,target_monday) values('rm',$1,$2,'2026-09-21') returning id`, [iid, ids.member])).id
const start = async () => (await val('select start_rm_review($1) id', [target])).id
const content = {blocks:[],title:'My feedback',html:'<p>Useful feedback for the team.</p>'}
const save = 'select save_voluntary_review($1,$2::jsonb,$3,$4)'
await actor(ids.pending)
await assert.rejects(start(), /approved account required/)
await actor(ids.member)
await assert.rejects(db.query('select start_rm_review($1)', [draft]), /submit the RM/)
const review = await start()
assert.equal(await start(), review, 'repeat click reuses the draft')
let row = await val('select * from documents where id=$1', [review])
assert.equal(row.reviewed_document_id, target)
assert.equal(row.reviewed_version_number, 1)
assert.equal(row.obligation_id, null)
await actor(ids.operations)
assert.equal((await db.query('select id from documents where id=$1', [review])).rows.length, 0, 'another member cannot read the private draft')
await assert.rejects(db.query(save, [review, JSON.stringify(content), 0, false]), /review author required/)
const outsiderReview = await start()
assert.notEqual(outsiderReview, review)
await actor(ids.member)
await db.query(save, [review, JSON.stringify(content), 0, false])
await assert.rejects(db.query(save, [review, JSON.stringify(content), 0, false]), /draft conflict/)
await db.query(save, [review, JSON.stringify(content), 1, true])
assert.equal(await start(), review, 'repeat click opens submitted review')
await actor(ids.operations)
assert.equal((await db.query('select id from documents where id=$1', [review])).rows.length, 1, 'submitted review is visible')
await actor(ids.member)
await db.query(save, [review, JSON.stringify(content), null, false])
await db.query(save, [review, JSON.stringify({...content, html:'<p>Revised feedback</p>'}), 0, true])
assert.equal((await val('select count(*)::int n from document_versions where document_id=$1',[review])).n, 2)
assert.deepEqual((await val('select content from document_versions where document_id=$1 and version_number=1',[review])).content, content)
await owner()
assert.equal((await val('select count(*)::int n from obligations')).n, 0)
assert.equal((await val('select count(*)::int n from hp_events')).n, 0)
const reviewingIni = (await val(`insert into initiatives(title,summary,lead_id) values('Reviewing initiative','The assigned reviewer team',$1) returning id`,[ids.research])).id
const cycle = (await val(`insert into cycles(starts_on,rm_due_at,review_due_at) values('2026-09-21','2026-09-25T23:59:00Z','2026-09-27T23:59:00Z') returning id`)).id
const obligation = (await val(`insert into obligations(cycle_id,initiative_id,kind,responsible_user_id,due_at,target_document_id,target_version)
 values($1,$2,'review',$3,'2026-09-27T23:59:00Z',$4,1) returning id`, [cycle, reviewingIni, ids.research, target])).id
await actor(ids.research)
const assignedReview = await start()
row = await val('select * from documents where id=$1', [assignedReview])
assert.equal(row.obligation_id, obligation)
assert.equal(row.is_voluntary_review, false)
assert.equal(await start(), assignedReview)
await db.close()
console.log('PASS: any approved member can Roast, including teammates; draft privacy, exact RM/version, repeated clicks, save conflicts, submission/revision, unchanged HP/cycles, and assigned-review reuse.')
