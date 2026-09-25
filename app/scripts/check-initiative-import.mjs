#!/usr/bin/env node
// End-to-end offline check of the generated initiative import and continuation flow.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const importDir = path.join(root, 'import-private/initiatives/ucsd-import')
const require = createRequire(path.join(root, 'app/package.json'))
const { PGlite } = require('@electric-sql/pglite')
const operatorId = '00000000-0000-4000-8000-000000000041'
const generatedSql = fs.readFileSync(path.join(importDir, 'import.sql'), 'utf8')
const operatorConfig = /set_config\('openlabs\.import_operator_id', '[0-9a-f-]*', true\)/g
assert.equal([...generatedSql.matchAll(operatorConfig)].length, 1, 'Expected one operator setting in generated SQL')
const sql = generatedSql.replace(operatorConfig,
  `set_config('openlabs.import_operator_id', '${operatorId}', true)`)
const editorSqlSource = fs.readFileSync(path.join(importDir, 'import-editor.sql'), 'utf8')
const editorOperator = /import_operator := '[0-9a-f-]*'::uuid;/g
assert.equal([...editorSqlSource.matchAll(editorOperator)].length, 1,
  'Expected one inline operator in SQL Editor artifact')
const editorSql = editorSqlSource.replace(editorOperator,
  `import_operator := '${operatorId}'::uuid;`)
assert.ok(!editorSql.includes('_ucsd_payload'), 'SQL Editor artifact must be self-contained')
const report = JSON.parse(fs.readFileSync(path.join(importDir, 'reconciliation-report.json'), 'utf8'))
const uploads = JSON.parse(fs.readFileSync(path.join(importDir, 'asset-upload-manifest.json'), 'utf8'))
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'import-private/initiatives/canonical-import-payload.json'), 'utf8'))
const idBySource = new Map(report.pendingDatabaseReconciliation
  .filter((r) => r.kind === 'initiative').map((r) => [r.sourceKey, r.proposedId]))
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
for (const file of fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  const body = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')
    .replace('create extension if not exists pgcrypto;', '')
  await db.exec(body)
}
const schemaMarkers = (await db.query(`select
  to_regclass('public.task_attachments') is not null as m017_task_attachments,
  (select is_nullable from information_schema.columns where table_schema='public'
    and table_name='initiatives' and column_name='lead_id') as lead_id_nullable,
  exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='initiatives' and column_name='lead_name') as m018_lead_name,
  exists (select 1 from pg_constraint where conrelid=to_regclass('public.initiatives')
    and conname='initiatives_lead_name_valid') as m018_lead_name_constraint,
  coalesce(pg_get_functiondef(to_regprocedure('public.transfer_lead(uuid,uuid)'))
    like '%research required to assign the first lead%',false) as m018_first_assignment,
  to_regprocedure('public.update_initiative_details(uuid,text,text,text,text,text)')
    is not null as m019_edit_function,
  exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='initiative_catalog' and column_name='lead_name') as m019_catalog_lead_name,
  coalesce(pg_get_functiondef(to_regprocedure('public.revise_rm(uuid,jsonb,text,uuid,text,integer)'))
    like '%initiative lead or Research/Admin required%',false) as m019_source_rm_revision`)).rows[0]
assert.equal(schemaMarkers.lead_id_nullable, 'YES')
for (const [key, value] of Object.entries(schemaMarkers)) {
  if (key !== 'lead_id_nullable') assert.equal(value, true, `Runbook schema marker ${key}`)
}
await db.query('insert into auth.users(id) values($1)', [operatorId])
await db.query("update public.profiles set account_status='approved' where id=$1", [operatorId])
const users = {
  research: '00000000-0000-4000-8000-000000000042',
  lead: '00000000-0000-4000-8000-000000000043',
  member: '00000000-0000-4000-8000-000000000044',
  pending: '00000000-0000-4000-8000-000000000045',
}
for (const id of Object.values(users)) await db.query('insert into auth.users(id) values($1)', [id])
await db.query("update public.profiles set account_status='approved' where id <> $1", [users.pending])
await db.query("update public.profiles set display_name='Approved Lead' where id=$1", [users.lead])
await db.query("insert into public.role_grants(user_id,role,granted_by) values($1,'research',$1)", [users.research])
const owner = async () => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub','',false)")
  await db.query("select set_config('request.jwt.claim.role','',false)")
}
const actor = async id => {
  await owner()
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.query("select set_config('request.jwt.claim.role','authenticated',false)")
  await db.exec('set role authenticated')
}
const count = async (query, params = []) => Number((await db.query(query, params)).rows[0].n)
const monday = weeksFromNow => {
  const day = new Date()
  day.setUTCHours(12, 0, 0, 0)
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) + 7 * weeksFromNow)
  return day.toISOString().slice(0, 10)
}
// Simulate the earlier canonical import, including its real IDs, v1 content and review links.
let docNumber = 0
for (const [index, row] of canonical.entries()) {
  const initiativeId = `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`
  idBySource.set(row.source_key, initiativeId)
  const originalContent = { html: row.payload.initiative.source_text, category: row.payload.initiative.category,
    historical: true, source_key: row.source_key }
  await db.query(`insert into public.initiatives(id,title,summary,content,status,lead_id,historical_source_key)
    values($1,$2,$3,$4::jsonb,$5,$6,$7)`, [initiativeId, row.payload.initiative.title,
    row.payload.initiative.summary, JSON.stringify(originalContent), 'active',
    operatorId, row.source_key])
  for (const period of row.payload.periods) {
    const rmId = `00000000-0000-4000-8000-${String(++docNumber + 2000).padStart(12, '0')}`
    await db.query(`insert into public.documents(id,kind,initiative_id,submitted_version_number,is_historical_import,historical_source_key)
      values($1,'rm',$2,1,true,$3)`, [rmId, initiativeId, period.rm.source_key])
    await db.query(`insert into public.document_versions(document_id,version_number,content)
      values($1,1,$2::jsonb)`, [rmId, JSON.stringify(period.rm.content)])
    if (period.review) {
      const reviewId = `00000000-0000-4000-8000-${String(++docNumber + 2000).padStart(12, '0')}`
      await db.query(`insert into public.documents(id,kind,initiative_id,reviewed_document_id,reviewed_version_number,
        submitted_version_number,is_historical_import,historical_source_key)
        values($1,'review',$2,$3,1,1,true,$4)`, [reviewId, initiativeId, rmId, period.review.source_key])
      await db.query(`insert into public.document_versions(document_id,version_number,content)
        values($1,1,$2::jsonb)`, [reviewId, JSON.stringify(period.review.content)])
    }
  }
}
for (const asset of uploads.assets) {
  const iid = idBySource.get(asset.initiativeSourceKey)
  if (!iid) throw new Error(`No proposed initiative ID for ${asset.initiativeSourceKey}`)
  await db.query("insert into storage.objects(bucket_id,name) values('initiative-images',$1)",
    [`${iid}/${asset.objectName}`])
}
const run = async () => {
  try {
    const offset = sql.indexOf('do $ucsd_import$')
    const setup = await db.exec(sql.slice(0, offset))
    const body = await db.exec(sql.slice(offset))
    return [...setup, ...body]
  }
  catch (error) { throw new Error(`Generated import SQL failed: ${error.message}; code=${error.code}; position=${error.position}; internalPosition=${error.internalPosition}; detail=${error.detail}; where=${String(error.where || '').slice(0, 500)}; routine=${error.routine}; file=${error.file}; line=${error.line}`) }
}
const first = await run()
const firstRows = first.find((r) => r?.rows?.[0]?.record_type)?.rows || []
assert.equal(firstRows.filter((r) => r.result === 'conflicted').length, 0)
assert.equal(firstRows.filter((r) => r.record_type === 'initiative' && r.result === 'matched').length, 2)
assert.equal(firstRows.filter((r) => r.record_type === 'rm_pdf_revision' && r.result === 'inserted').length, report.expected.canonicalPdfRevisions)
assert.equal(firstRows.filter((r) => r.record_type === 'asset' && r.result === 'inserted').length, uploads.assets.length)
const sona = await db.query(`select count(*)::int n from public.document_versions v
  join public.documents d on d.id = v.document_id
  where d.initiative_id = $1 and v.version_number = 2
    and v.content->>'source_pdf_revision_key' is not null
    and v.content->>'html' like '%data-object-path=%'`, [idBySource.get('local-canonical:20260910:sona')])
assert.ok(sona.rows[0].n > 0, 'SONA PDF revisions retain inline pictures')
const counts = async () => ({
  initiatives: Number((await db.query("select count(*) n from initiatives where historical_source_key is not null")).rows[0].n),
  documents: Number((await db.query("select count(*) n from documents where is_historical_import")).rows[0].n),
  versions: Number((await db.query("select count(*) n from document_versions v join documents d on d.id=v.document_id where d.is_historical_import")).rows[0].n),
  tasks: Number((await db.query('select count(*) n from tasks')).rows[0].n),
  memberships: Number((await db.query('select count(*) n from initiative_memberships')).rows[0].n),
  cycles: Number((await db.query('select count(*) n from cycles')).rows[0].n),
  obligations: Number((await db.query('select count(*) n from obligations')).rows[0].n),
  hp: Number((await db.query('select count(*) n from hp_events')).rows[0].n),
  accounts: Number((await db.query('select count(*) n from auth.users')).rows[0].n),
})
const before = await counts()
assert.equal(before.initiatives, report.expected.initiatives)
assert.equal(before.documents, report.expected.targetRms + report.expected.reviews)
assert.equal(before.versions, before.documents + report.expected.canonicalPdfRevisions)
assert.equal(before.tasks, report.expected.tasks)
assert.equal(before.memberships + before.cycles + before.obligations + before.hp, 0)
assert.equal(before.accounts, 5)
assert.equal(await count("select count(*)::int n from initiatives where historical_source_key='local-canonical:20260910:sona'"), 1)
assert.equal(await count(`select count(*)::int n from documents d where d.kind='review'
  and (d.reviewed_document_id is null or d.reviewed_version_number <> 1)`), 0)
assert.equal(Number((await db.query('select count(*) n from document_attachments')).rows[0].n), uploads.assets.length)
const second = await run()
assert.deepEqual(await counts(), before)
// Simulate the Dashboard submitting only the selected statement in a fresh
// transaction. The editor artifact must not rely on any setup statement.
await db.exec(editorSql)
assert.deepEqual(await counts(), before)
// Both manual and scheduled cycle routines skip text-only leads.
const textOnly = idBySource.get('ucsd:OLIN-131')
const assigned = idBySource.get('local-canonical:20260910:sona')
await db.query('update initiatives set activated_at=$1 where id in ($2,$3)',
  ['2025-01-01', textOnly, assigned])
await actor(users.research)
await db.query('select open_cycle($1,false)', [monday(-2)])
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [textOnly]), 0)
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [assigned]), 2)
await owner()
await db.query('select run_weekly_processing($1)', [`${monday(2)}T12:05:00Z`])
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [textOnly]), 0)
assert.equal(await count('select count(*)::int n from obligations where initiative_id=$1', [assigned]), 4)
await actor(users.member)
await assert.rejects(db.query('select transfer_lead($1,$2)', [textOnly, users.lead]), /research required/)
await actor(users.research)
await assert.rejects(db.query('select transfer_lead($1,$2)', [textOnly, users.pending]), /approved account/)
await db.query('select transfer_lead($1,$2)', [textOnly, users.lead])
assert.equal((await db.query('select lead_id,lead_name from initiatives where id=$1', [textOnly])).rows[0].lead_id, users.lead)
assert.equal(await count("select count(*)::int n from initiative_memberships where initiative_id=$1 and user_id=$2 and role='lead' and left_at is null", [textOnly, users.lead]), 1)
assert.equal((await db.query('select lead_name from initiative_catalog where id=$1', [textOnly])).rows[0].lead_name,
  'Enrique Aranda')
await actor(users.lead)
await db.query('select update_initiative_details($1,$2,$3,$4,$5,$6)',
  [textOnly, 'Brain DJ continued', 'A sufficiently long project abstract', 'Neuroengineering',
    'Continue the project', '<p>Continued overview</p>'])
assert.equal((await db.query('select title from initiatives where id=$1', [textOnly])).rows[0].title,
  'Brain DJ continued')
const sourceRm = report.pendingDatabaseReconciliation.find(r => r.kind === 'rm' && r.sourceKey.startsWith('ucsd:OLIN-131'))
assert.ok(sourceRm, 'source RM to revise')
const originalVersion = (await db.query('select content from document_versions where document_id=$1 and version_number=1',
  [sourceRm.proposedId])).rows[0].content
await db.query('select revise_rm($1,$2::jsonb,$3,null,null,$4)',
  [sourceRm.proposedId, JSON.stringify({ blocks: [], html: '<p>Team revision</p>' }), 'Team correction', 1])
assert.deepEqual((await db.query('select content from document_versions where document_id=$1 and version_number=1',
  [sourceRm.proposedId])).rows[0].content, originalVersion)
assert.equal(await count('select count(*)::int n from document_versions where document_id=$1', [sourceRm.proposedId]), 2)
const newTask = (await db.query('select create_task($1,$2,$3) id',
  [textOnly, 'Resume prototype', 'Team work after assignment'])).rows[0].id
assert.ok(newTask)
await actor(users.research)
await db.query('select open_cycle($1,false)', [monday(3)])
await actor(users.lead)
const content = JSON.stringify({ blocks: [], html: '<p>New Roast Me</p>' })
const draft = (await db.query('select save_rm_draft($1,$2::jsonb,$3,null,null) id',
  [textOnly, content, monday(3)])).rows[0].id
await db.query('select submit_rm_draft($1,$2::jsonb)', [draft, content])
assert.equal(await count("select count(*)::int n from documents where id=$1 and kind='rm' and submitted_version_number=1", [draft]), 1)
await owner()
const continued = await run()
const continuedRows = continued.find(r => r?.rows?.[0]?.record_type)?.rows || []
assert.equal(continuedRows.filter(r => r.result === 'inserted').length, 0)
assert.equal((await db.query('select title,lead_id from initiatives where id=$1', [textOnly])).rows[0].title,
  'Brain DJ continued')
assert.equal((await db.query('select lead_id from initiatives where id=$1', [textOnly])).rows[0].lead_id,
  users.lead)
assert.equal(await count('select count(*)::int n from document_versions where document_id=$1', [sourceRm.proposedId]), 2)
assert.equal(await count('select count(*)::int n from tasks where id=$1', [newTask]), 1)
assert.equal(await count('select count(*)::int n from documents where id=$1', [draft]), 1)
const afterContinuation = await counts()
const resultRows = second.find((r) => r?.rows?.[0]?.record_type)?.rows || []
assert.equal(resultRows.filter((r) => r.result === 'inserted').length, 0)
assert.equal(resultRows.filter((r) => r.result === 'conflicted').length, 0)
assert.equal(resultRows.filter((r) => r.result === 'missing-source').length, 0)
const editedTask = report.pendingDatabaseReconciliation.find((r) => r.kind === 'task')
await db.query("update public.tasks set title='Resumed member work' where id=$1", [editedTask.proposedId])
const third = await run()
const thirdRows = third.find((r) => r?.rows?.[0]?.record_type)?.rows || []
assert.equal(thirdRows.filter((r) => r.record_type === 'task' && r.source_key === editedTask.sourceKey
  && r.result === 'conflicted').length, 1)
assert.equal((await db.query('select title from public.tasks where id=$1', [editedTask.proposedId])).rows[0].title,
  'Resumed member work')
assert.deepEqual(await counts(), afterContinuation)
await db.close()
console.log(`PASS: offline import twice, cycles, assignment, edits, source revision, new task/RM, and rerun; ${before.initiatives} initiatives, ${before.documents} imported documents, ${before.tasks} imported tasks.`)
