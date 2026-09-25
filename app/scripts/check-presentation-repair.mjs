// Offline database regression for the repair, starting from the actual frozen old import.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const here = path.join(root, 'import-private/initiatives/ucsd-import')
const read = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'))
const payload = read('presentation-repair-payload.json')
const desired = read('import-payload.json')
const uploads = read('asset-upload-manifest.json')
const operator = '00000000-0000-4000-8000-000000000041'
const oldSql = fs.readFileSync(path.join(here, 'presentation-baseline/import.sql'), 'utf8')
  .replace(/set_config\('openlabs\.import_operator_id', '[0-9a-f-]*', true\)/,
    `set_config('openlabs.import_operator_id', '${operator}', true)`)
const repair = fs.readFileSync(path.join(here, 'presentation-repair.sql'), 'utf8')
  .replace(/operator_id uuid := nullif\('[0-9a-f-]*', ''\)::uuid;/, `operator_id uuid := '${operator}'::uuid;`)
const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated;`)
for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8').replace('create extension if not exists pgcrypto;', ''))
}
await db.query('insert into auth.users(id) values($1)', [operator])
await db.query("update public.profiles set account_status='approved' where id=$1", [operator])
const ids = new Map(desired.initiatives.map(i => [i.source_key,i.id]))
const oldUploads = read('presentation-baseline/asset-upload-manifest.json')
for (const a of oldUploads.assets) await db.query("insert into storage.objects(bucket_id,name) values('initiative-images',$1)",
  [`${ids.get(a.initiativeSourceKey)}/${a.objectName}`])
try { await db.exec(oldSql) } catch (e) { throw Error(`Baseline failed: ${e.message}`) }
const run = async () => {
  try {
    const result = await db.exec('begin;\n' + repair + '\nselect * from _ucsd_presentation_report;\ncommit;')
    return result.find(r => r.rows?.[0]?.source_key)?.rows || []
  } catch (e) { throw Error(`Repair failed: ${e.message}; position=${e.position}; context=${e.where}`) }
}
const snapshot = async () => ({
  initiatives: (await db.query('select id,title,summary,status,lead_id,lead_name from initiatives order by id')).rows,
  reviews: (await db.query("select d.*,v.content from documents d join document_versions v on d.id=v.document_id where d.kind='review' order by d.id,v.version_number")).rows,
  tasks: (await db.query('select * from tasks order by id')).rows,
  versions: (await db.query('select document_id,version_number,content from document_versions order by document_id,version_number')).rows,
})
// Reproduce the known SONA extra motivation field without losing its existing wording.
const sona = payload.initiatives.find(i => i.source_key.endsWith(':sona'))
const liveSona = sona.expected_contents.find(c => c.historical && c.motivation)
assert.ok(liveSona, 'Known live SONA baseline is retained')
await db.query('update initiatives set content=$1::jsonb where historical_source_key=$2', [JSON.stringify(liveSona),sona.source_key])
const original = await snapshot()
const missingImages = await run()
assert.ok(missingImages.some(r => r.result === 'conflicted' && r.detail.startsWith('Image missing')), 'Missing derived uploads block only affected RMs')
for (const a of uploads.assets) {
  const objectPath = `${ids.get(a.initiativeSourceKey)}/${a.objectName}`
  await db.query(`insert into storage.objects(bucket_id,name) select 'initiative-images',$1
    where not exists(select 1 from storage.objects where bucket_id='initiative-images' and name=$1)`, [objectPath])
}
const repaired = await run()
assert.equal(repaired.filter(r => r.result === 'conflicted').length, 0)
const after = await snapshot()
assert.deepEqual(after.initiatives, original.initiatives)
assert.deepEqual(after.reviews, original.reviews)
assert.deepEqual(after.tasks, original.tasks)
assert.equal(after.versions.length, original.versions.length + 31)
for (const v of original.versions) assert.deepEqual(after.versions.find(x => x.document_id===v.document_id && x.version_number===v.version_number),v)
const content = (await db.query('select content from initiatives where historical_source_key=$1',[sona.source_key])).rows[0].content
assert.equal(content.motivation,liveSona.motivation)
assert.ok(!content.html.includes('Humans are visual animals'), 'Motivation no longer repeats in overview')
assert.ok(!content.html.includes('<pre>'))
const second = await run()
assert.equal(second.filter(r => r.result !== 'matched').length, 0)
assert.deepEqual(await snapshot(),after)
// A member's later RM revision and initiative change must survive another repair.
const rm = (await db.query("select d.id,v.content,v.version_number from documents d join document_versions v on v.document_id=d.id where d.kind='rm' order by v.version_number desc limit 1")).rows[0]
await db.exec("select set_config('openlabs.rm_revision','1',false)")
await db.query('insert into document_versions(document_id,version_number,content,created_by) values($1,$2,$3::jsonb,$4)',
  [rm.id,rm.version_number+1,JSON.stringify({...rm.content,html:'<p>Member continuation</p>'}),operator])
await db.exec("select set_config('openlabs.rm_revision','0',false)")
await db.query("update initiatives set content=jsonb_set(content,'{html}','\"<p>Member overview</p>\"'::jsonb) where historical_source_key=$1",[sona.source_key])
const edited = await snapshot()
const third = await run()
assert.equal(third.filter(r => r.result==='conflicted').length,2)
assert.deepEqual(await snapshot(),edited)
assert.equal(Number((await db.query('select count(*) n from initiative_memberships')).rows[0].n),0)
assert.equal(Number((await db.query('select count(*) n from obligations')).rows[0].n),0)
assert.equal(Number((await db.query('select count(*) n from hp_events')).rows[0].n),0)
await db.close()
console.log('PASS: old import repaired; 31 appended RM versions, motivation deduplicated, images preflighted, rerun idempotent, member edits and original versions/reviews/tasks preserved.')
