// Offline contract check for 202609100013. Run from app/:
//   node scripts/check-rm-cycle.mjs
//
// "RM" is a Roast Me: constructive criticism of a team's work, never a
// reporting memo. This covers the root failure (drafting required an obligation,
// which required a cycle), the imported-initiative gap that made it fail even
// after a cycle was opened, target-week selection, and the authorisation and
// duplicate rules that must survive all of it.
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
  research: '00000000-0000-4000-8000-000000000001',
  lead:     '00000000-0000-4000-8000-000000000002',
  member:   '00000000-0000-4000-8000-000000000003',
  outsider: '00000000-0000-4000-8000-000000000004',
  pending:  '00000000-0000-4000-8000-000000000005',
}
for (const id of Object.values(ids)) await db.query('insert into auth.users(id) values($1)', [id])
await db.exec(`update profiles set account_status='approved' where id<>'${ids.pending}';
 insert into role_grants(user_id,role,granted_by) values('${ids.research}','research','${ids.research}');`)

async function actor(id) {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id ?? ''])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',false)`)
  await db.exec('set role authenticated')
}
async function root() {
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub','',false)`)
  await db.query(`select set_config('request.jwt.claim.role','service_role',false)`)
}
const rejected = (sql, p = []) => assert.rejects(db.query(sql, p))
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const val = async (sql, p = []) => Object.values(await one(sql, p))[0]
const iso = (d) => d.toISOString().slice(0, 10)
// Midday UTC keeps the arithmetic clear of any offset edge.
const addDays = (day, n) => iso(new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000))

// The LA Monday the database itself defaults to, and neighbouring weeks.
await actor(ids.research)
const thisWeek = iso(new Date(await val('select public.current_la_monday()')))
assert.equal(new Date(thisWeek + 'T12:00:00Z').getUTCDay(), 1, 'current_la_monday must be a Monday')
const nextWeek = addDays(thisWeek, 7)
const notMonday = addDays(thisWeek, 1)

// --- an initiative whose activated_at falls inside its target week ---------
// This is the canonical import shape: a real approved lead, a membership row,
// and an activation date part-way through the week, which makes open_cycle skip
// it (i < monday is false) and used to leave the team stuck. The target week is
// nextWeek so its Friday deadline is always ahead, whatever day this runs.
await root()
const initiative = await val(`insert into initiatives(title,summary,content,lead_id,historical_source_key,activated_at)
  values('SONA','Imported','{"blocks":[]}'::jsonb,$1,'local-canonical:test:sona',$2::timestamptz) returning id`,
  [ids.lead, addDays(nextWeek, 2) + 'T12:00:00Z'])
await db.query(`insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,'lead')`, [initiative, ids.lead])
await db.query(`insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,'member')`, [initiative, ids.member])

// --- root failure: drafting with no cycle at all --------------------------
assert.equal(await val('select count(*)::int from cycles'), 0)
await actor(ids.member)
const draft = await val(`select public.save_rm_draft($1,$2::jsonb,null,null,null)`,
  [initiative, JSON.stringify({ blocks: [], html: '<p>Roast this.</p>' })])
assert.ok(draft, 'a team member can draft before any cycle exists')
const row = await one(`select obligation_id, target_monday, author_id, submitted_version_number from documents where id=$1`, [draft])
assert.equal(row.obligation_id, null)
assert.equal(iso(new Date(row.target_monday)), thisWeek)      // current LA week by default
assert.equal(row.author_id, ids.member)
assert.equal(row.submitted_version_number, null)
assert.equal(await val('select count(*)::int from obligations'), 0, 'drafting must not invent an obligation')
// The team can read its own pre-cycle draft back through RLS.
assert.equal(await val('select count(*)::int from documents where id=$1', [draft]), 1)
assert.equal(await val('select count(*)::int from document_drafts where document_id=$1', [draft]), 1)
assert.equal(await val('select public.can_edit_document($1)', [draft]), true)

// Opening the same week again reuses the draft without needing a revision token
// and, importantly, does not overwrite its content.
assert.equal(await val(`select public.save_rm_draft($1,$2::jsonb,null,null,null)`,
  [initiative, JSON.stringify({ blocks: [], html: '<p>must not replace</p>' })]), draft)
assert.equal(await val(`select content->>'html' from document_drafts where document_id=$1`, [draft]),
  '<p>Roast this.</p>')
// Saving through the document path still honours the revision check.
assert.equal(await val(`select public.save_rm_draft($1,$2::jsonb,null,null,0)`,
  [initiative, JSON.stringify({ blocks: [], html: '<p>more</p>' })]), draft)
await rejected(`select public.save_rm_draft($1,$2::jsonb,null,$3,0)`,
  [initiative, JSON.stringify({ blocks: [] }), draft])
assert.equal(await val('select count(*)::int from documents where initiative_id=$1', [initiative]), 1)

// --- authorisation --------------------------------------------------------
await actor(ids.outsider)
await rejected(`select public.save_rm_draft($1,$2::jsonb,null,null,null)`, [initiative, JSON.stringify({ blocks: [] })])
await rejected(`select public.set_rm_draft_target($1,$2)`, [draft, nextWeek])
assert.equal(await val('select count(*)::int from documents where id=$1', [draft]), 0, 'a draft is not readable outside the team')
await actor(ids.pending)
await rejected(`select public.save_rm_draft($1,$2::jsonb,null,null,null)`, [initiative, JSON.stringify({ blocks: [] })])
await actor(ids.member)
await rejected(`select public.save_rm_draft($1,$2::jsonb,$3,null,null)`,
  [initiative, JSON.stringify({ blocks: [] }), notMonday])

// --- retargeting before submission ---------------------------------------
await db.query(`select public.set_rm_draft_target($1,$2)`, [draft, nextWeek])
assert.equal(iso(new Date(await val('select target_monday from documents where id=$1', [draft]))), nextWeek)
const otherWeek = addDays(nextWeek, 7)
const otherDraft = await val(`select public.save_rm_draft($1,$2::jsonb,$3,null,null)`,
  [initiative, JSON.stringify({ blocks: [] }), otherWeek])
await assert.rejects(db.query(`select public.set_rm_draft_target($1,$2)`, [otherDraft, nextWeek]),
  /already exists/)
// Pending week: a clear refusal, and the draft survives it.
await actor(ids.lead)
await assert.rejects(
  db.query(`select public.submit_rm_draft($1,$2::jsonb)`, [draft, JSON.stringify({ blocks: [], html: '<p>x</p>' })]),
  /not open yet/)
assert.equal(await val('select count(*)::int from documents where id=$1', [draft]), 1)

// --- submitting into the selected week -------------------------------------
// open_cycle skips this initiative because it activated after the week began,
// which is exactly what used to leave the team stuck after "open a cycle".
await actor(ids.research)
await db.query(`select public.open_cycle($1,false)`, [nextWeek])
assert.equal(await val(`select count(*)::int from obligations o join cycles c on c.id=o.cycle_id
  where c.starts_on=$1 and o.initiative_id=$2`, [nextWeek, initiative]), 0)

await actor(ids.member)
await rejected(`select public.submit_rm_draft($1,$2::jsonb)`, [draft, JSON.stringify({ blocks: [] })])  // lead submits
await actor(ids.lead)
const submitted = await val(`select public.submit_rm_draft($1,$2::jsonb)`,
  [draft, JSON.stringify({ blocks: [], html: '<p>Roast this.</p>' })])
assert.equal(submitted, draft)
const after = await one(`select obligation_id, submitted_version_number, target_monday from documents where id=$1`, [draft])
assert.ok(after.obligation_id, 'submission attaches the week\'s obligation')
assert.equal(after.submitted_version_number, 1)
assert.equal(iso(new Date(after.target_monday)), nextWeek)
assert.equal(await val(`select count(*)::int from obligations o join cycles c on c.id=o.cycle_id
  where c.starts_on=$1 and o.initiative_id=$2 and o.kind='rm'`, [nextWeek, initiative]), 1,
  'exactly one RM obligation for the week')
assert.equal(await val(`select status from obligations where id=$1`, [after.obligation_id]), 'submitted')
assert.equal(await val(`select count(*)::int from hp_events where initiative_id=$1 and kind='reward'`, [initiative]), 1)

// Re-running open_cycle after the fact adds no second obligation.
await actor(ids.research)
await db.query(`select public.open_cycle($1,false)`, [nextWeek])
assert.equal(await val(`select count(*)::int from obligations o join cycles c on c.id=o.cycle_id
  where c.starts_on=$1 and o.initiative_id=$2 and o.kind='rm'`, [nextWeek, initiative]), 1)

// A submitted Roast Me keeps its week and cannot be retargeted or re-drafted.
await actor(ids.lead)
await rejected(`select public.set_rm_draft_target($1,$2)`, [draft, thisWeek])
await rejected(`select public.save_rm_draft($1,$2::jsonb,null,$3,null)`,
  [initiative, JSON.stringify({ blocks: [] }), draft])

// A second draft for the same, already-submitted week cannot be started.
await actor(ids.member)
await assert.rejects(
  db.query(`select public.save_rm_draft($1,$2::jsonb,$3,null,null)`,
    [initiative, JSON.stringify({ blocks: [], html: '<p>again</p>' }), nextWeek]),
  /already exists/)

// --- break weeks and past weeks ------------------------------------------
await actor(ids.research)
const breakWeek = addDays(nextWeek, 7)
await db.query(`select public.open_cycle($1,true)`, [breakWeek])
await actor(ids.member)
const onBreak = await val(`select public.save_rm_draft($1,$2::jsonb,$3,null,null)`,
  [initiative, JSON.stringify({ blocks: [] }), breakWeek])
await actor(ids.lead)
await assert.rejects(
  db.query(`select public.submit_rm_draft($1,$2::jsonb)`, [onBreak, JSON.stringify({ blocks: [] })]),
  /break week/)

// A week whose deadline has passed and that never got an obligation is refused
// rather than back-filled, so no past cycle can be mined for HP.
await root()
const pastWeek = addDays(thisWeek, -21)
await db.query(`insert into cycles(starts_on,rm_due_at,review_due_at) values($1,$2,$3)`,
  [pastWeek, pastWeek + 'T12:00:00Z', pastWeek + 'T18:00:00Z'])
await actor(ids.member)
const stale = await val(`select public.save_rm_draft($1,$2::jsonb,$3,null,null)`,
  [initiative, JSON.stringify({ blocks: [] }), pastWeek])
await actor(ids.lead)
await assert.rejects(
  db.query(`select public.submit_rm_draft($1,$2::jsonb)`, [stale, JSON.stringify({ blocks: [] })]),
  /has passed/)

// --- 202609100011/012 are untouched --------------------------------------
await root()
const histKey = 'notion:legacy:w1:rm'
const hist = await val(`insert into documents(kind,initiative_id,submitted_version_number,is_historical_import,historical_source_key)
  values('rm',$1,1,true,$2) returning id`, [initiative, histKey])
await db.query(`insert into document_versions(document_id,version_number,content,created_by) values($1,1,$2::jsonb,null)`,
  [hist, JSON.stringify({ blocks: [], historical: 'true', source_key: histKey, source_author: 'A. Historian',
    source_period: 'Spring 2025', source_week: 'Week 1', source_record_count: 2 })])
await actor(ids.lead)
assert.equal(await val('select public.can_edit_document($1)', [hist]), false,
  'an imported Roast Me stays outside the editable set')
await rejected(`select public.save_rm_draft($1,$2::jsonb,null,$3,null)`,
  [initiative, JSON.stringify({ blocks: [] }), hist])
await rejected(`select public.set_rm_draft_target($1,$2)`, [hist, thisWeek])
await rejected(`select public.submit_rm_draft($1,$2::jsonb)`, [hist, JSON.stringify({ blocks: [] })])
await rejected(`select public.attach_rm_image($1,$2,'image/png',100,null,null)`, [hist, initiative + '/x.png'])
// Research still reaches it, exactly as 012 left things.
await actor(ids.research)
assert.ok(await val(`select public.attach_rm_image($1,$2,'image/png',100,null,null)`, [hist, initiative + '/x.png']))

await db.close()
console.log('PASS: Roast Me drafting without a cycle, current-LA-week default, retargeting,')
console.log('      imported-initiative obligation gap closed at submit, lead-only submission,')
console.log('      one RM obligation per week, break/past-week refusals, historical records untouched.')
