// Offline check for migration 019. Run from app/.
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
const editSql = 'select public.update_initiative_details($1,$2,$3,$4,$5,$6)'
const editArgs = id => [id, 'New title', 'A sufficiently long abstract', 'Neuroengineering', 'Why it matters', '<p>New overview</p>']
const reviseSql = 'select public.revise_rm($1,$2::jsonb,$3,null,$4,$5)'

const iid = (await val(`insert into initiatives(title,summary,content,lead_id,lead_name,historical_source_key)
 values('Source title','Source abstract',
 '{"blocks":[],"source_key":"ucsd:OLIN-999","source_dates":["2022-01-01"],"html":"<p>Old</p>"}'::jsonb,
 null,'Original Lead','ucsd:OLIN-999') returning id`)).id
await actor(ids.member)
assert.deepEqual(await val("select auth.uid() uid, public.is_approved() approved, public.is_admin() admin"), { uid: ids.member, approved: true, admin: false })
await assert.rejects(db.query(editSql, editArgs(iid)), /initiative lead or Research\/Admin required/)
await actor(ids.operations)
await assert.rejects(db.query(editSql, editArgs(iid)), /initiative lead or Research\/Admin required/)
await actor(ids.pending)
await assert.rejects(db.query(editSql, editArgs(iid)), /approved account required/)
await actor(ids.research)
await assert.rejects(db.query(editSql, [iid, 'No', ...editArgs(iid).slice(2)]), /title must be/)
await db.query(editSql, editArgs(iid))
let i = await val('select title,summary,content,lead_name from initiatives where id=$1', [iid])
assert.equal(i.title, 'New title')
assert.equal(i.summary, 'A sufficiently long abstract')
assert.equal(i.content.category, 'Neuroengineering')
assert.equal(i.content.motivation, 'Why it matters')
assert.equal(i.content.html, '<p>New overview</p>')
assert.equal(i.content.source_key, 'ucsd:OLIN-999')
assert.deepEqual(i.content.source_dates, ['2022-01-01'])
assert.equal(i.lead_name, 'Original Lead')
assert.equal((await val("select count(*)::int n from audit_events where action='initiative_details_updated' and entity_id=$1", [iid])).n, 1)
const catalog = await val('select lead_name from initiative_catalog where id=$1', [iid])
assert.equal(catalog.lead_name, 'Original Lead')
await db.query('select transfer_lead($1,$2)', [iid, ids.lead])
await actor(ids.lead)
await db.query(editSql, [iid, 'Lead updated title', 'The lead updated this abstract', 'Engineering', '', '<p>Updated</p>'])
assert.equal((await val('select title from initiatives where id=$1', [iid])).title, 'Lead updated title')

await owner()
const key = 'ucsd:OLIN-999:RM-1'
const did = (await val(`insert into documents(kind,initiative_id,submitted_version_number,is_historical_import,historical_source_key)
 values('rm',$1,1,true,$2) returning id`, [iid, key])).id
const source = { blocks: [], html: '<p>Original RM</p>', historical: 'true', source_key: key,
  source_author: 'Original Author', source_period: null, source_week: 'Week 1', source_record_count: 1 }
await db.query('insert into document_versions(document_id,version_number,content) values($1,1,$2::jsonb)', [did, JSON.stringify(source)])
const review = (await val(`insert into documents(kind,initiative_id,reviewed_document_id,reviewed_version_number,submitted_version_number,is_historical_import,historical_source_key)
 values('review',$1,$2,1,1,true,$3) returning id`, [iid, did, key + ':review'])).id
await actor(ids.member)
await assert.rejects(db.query(reviseSql, [did, JSON.stringify({ blocks: [] }), 'fix', 'Original Author', 1]), /initiative lead or Research\/Admin required/)
await actor(ids.operations)
await assert.rejects(db.query(reviseSql, [did, JSON.stringify({ blocks: [] }), 'fix', 'Original Author', 1]), /initiative lead or Research\/Admin required/)
await actor(ids.lead)
await assert.rejects(db.query(reviseSql, [did, JSON.stringify({ blocks: [] }), 'fix', 'Changed Author', 1]), /source author attribution/)
await db.query(reviseSql, [did, JSON.stringify({ blocks: [], html: '<p>Revised RM</p>' }), 'continue work', 'Original Author', 1])
await assert.rejects(db.query(reviseSql, [did, JSON.stringify({ blocks: [] }), 'stale', 'Original Author', 1]), /revision conflict/)
const versions = (await db.query('select version_number,content from document_versions where document_id=$1 order by version_number', [did])).rows
assert.equal(versions.length, 2)
assert.deepEqual(versions[0].content, source)
assert.equal(versions[1].content.source_author, 'Original Author')
assert.equal(versions[1].content.source_key, key)
assert.equal(versions[1].content.source_week, 'Week 1')
assert.equal((await val('select reviewed_version_number from documents where id=$1', [review])).reviewed_version_number, 1)
assert.equal((await val('select submitted_version_number from documents where id=$1', [did])).submitted_version_number, 1)
await actor(ids.research)
await db.query(reviseSql, [did, JSON.stringify({ blocks: [] }), 'correct attribution', 'Corrected Author', 2])
assert.equal((await val('select content from document_versions where document_id=$1 and version_number=3', [did])).content.source_author, 'Corrected Author')
await actor(ids.lead)
await db.query(reviseSql, [did, JSON.stringify({ blocks: [], html: '<p>Continued</p>' }), 'continue after correction', 'Corrected Author', 3])
assert.equal((await val('select content from document_versions where document_id=$1 and version_number=4', [did])).content.source_author, 'Corrected Author')
await db.close()
console.log('PASS: initiative edit access/validation/provenance/audit and imported RM lead revision/version/review protections.')
