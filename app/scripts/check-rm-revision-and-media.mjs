// Offline contract check for 202609100012. Run from app/:
//   node scripts/check-rm-revision-and-media.mjs
//
// Covers: the >=150 word motivation gate on proposal submit/approve; the
// Research-only revise_rm for live and historical RMs (append-only versions,
// author attribution, no HP/obligation/review/role change, immutable v1 and
// provenance); the approved-only initiative-covers audience and lead/admin
// write authority; and the document-linked initiative-images audience
// (submitted RM -> approved; draft RM -> editors + Research) with MIME/size
// bounds.
import {PGlite} from '@electric-sql/pglite'
import {readFileSync, readdirSync} from 'node:fs'
import assert from 'node:assert/strict'

const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema storage to anon,authenticated;
 grant select,insert,update,delete on storage.objects to authenticated;`)
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
const MOTIV = Array.from({length: 160}, (_, i) => 'reason' + i).join(' ') // 160 words

// --- count_words --------------------------------------------------------------
await actor(ids.research)
assert.equal(await val(`select public.count_words('')`), 0)
assert.equal(await val(`select public.count_words(null)`), 0)
assert.equal(await val(`select public.count_words(E'  one   two\nthree ')`), 3)
assert.equal(await val(`select public.count_words($1)`, [MOTIV]), 160)

// --- motivation gate on proposals ------------------------------------------
await actor(ids.lead)
const draftId = await val(`select public.save_proposal('Cover Pilot','Summary','{}'::jsonb,false,null)`)
await rejected(`select public.save_proposal('Cover Pilot','Summary','{}'::jsonb,true,$1)`, [draftId])
await rejected(`select public.save_proposal('Cover Pilot','Summary',$1::jsonb,true,$2)`,
  [JSON.stringify({motivation: 'too short'}), draftId])
const propId = await val(`select public.save_proposal('Cover Pilot','Summary',$1::jsonb,true,$2)`,
  [JSON.stringify({motivation: MOTIV, html: '<p>plan</p>', category: 'Neuroengineering'}), draftId])

await root(); await db.query(`update proposals set content=$1 where id=$2`, [JSON.stringify({motivation: 'nope'}), propId])
await actor(ids.research)
await rejected(`select public.decide_proposal($1,'approved','ok')`, [propId])
await root(); await db.query(`update proposals set content=$1 where id=$2`, [JSON.stringify({motivation: MOTIV}), propId])
await actor(ids.research)
const iidA = await val(`select public.decide_proposal($1,'approved','ok')`, [propId])
assert.ok(iidA)
// re-approve is idempotent and is not re-checked against the motivation rule
await root(); await db.query(`update proposals set content='{}'::jsonb where id=$1`, [propId])
await actor(ids.research)
assert.equal(await val(`select public.decide_proposal($1,'approved','again')`, [propId]), iidA)

// --- a live submitted RM to revise ---------------------------------------
await root()
await db.query(`update initiatives set activated_at='2020-01-01' where id=$1`, [iidA])
await db.query(`select open_cycle('2026-03-09',false)`)
const rmObA = (await one(`select id from obligations where initiative_id=$1 and kind='rm'`, [iidA])).id
await actor(ids.lead)
const v1content = {blocks: [], html: '<p>v1 progress</p>', title: 'Week one'}
const didA = await val(`select public.submit_obligation($1,$2::jsonb,null,null)`, [rmObA, JSON.stringify(v1content)])
// member joins so it can be named as the RM author
await actor(ids.member)
const jr = await val(`select public.request_join($1,'help please')`, [iidA])
await actor(ids.lead)
await db.query(`select public.decide_join_request($1,true,'welcome')`, [jr])

// --- revise_rm: live ----------------------------------------------------
await actor(ids.lead)
await rejected(`select public.revise_rm($1,$2::jsonb,'fix',null,null,1)`, [didA, JSON.stringify({blocks: [], html: '<p>x</p>'})])
await actor(ids.research)
await rejected(`select public.revise_rm($1,$2::jsonb,'   ',null,null,1)`, [didA, JSON.stringify({blocks: []})])
await rejected(`select public.revise_rm($1,$2::jsonb,'fix',null,null,1)`, [didA, JSON.stringify({html: 'no blocks'})])
await rejected(`select public.revise_rm($1,$2::jsonb,'x',null,'Ghost',1)`, [didA, JSON.stringify({blocks: []})])

const hpBefore = await val(`select public.hp_balance($1)`, [iidA])
const hpEventsBefore = await val(`select count(*)::int from hp_events where initiative_id=$1`, [iidA])
const v2content = {blocks: [{t: 'p'}], html: '<p>v2 corrected</p>', title: 'Week one (fixed)'}
await db.query(`select public.revise_rm($1,$2::jsonb,'corrected a figure',null,null,1)`, [didA, JSON.stringify(v2content)])

let versionsA = (await db.query(
  `select version_number,content,created_by from document_versions where document_id=$1 order by version_number`, [didA])).rows
assert.equal(versionsA.length, 2)
assert.deepEqual(versionsA[0].content, v1content)            // original preserved verbatim
assert.equal(versionsA[0].created_by, ids.lead)
assert.equal(versionsA[1].content.html, '<p>v2 corrected</p>')
assert.equal(versionsA[1].content.revision_reason, 'corrected a figure')
assert.equal(versionsA[1].created_by, ids.research)
assert.equal(await val(`select submitted_version_number from documents where id=$1`, [didA]), 2)
assert.equal(await val(`select public.hp_balance($1)`, [iidA]), hpBefore)
assert.equal(await val(`select count(*)::int from hp_events where initiative_id=$1`, [iidA]), hpEventsBefore)

// A stale Research edit is rejected; author attribution then moves without
// changing the obligation's responsible user.
await rejected(`select public.revise_rm($1,$2::jsonb,'stale',null,null,1)`, [didA, JSON.stringify(v2content)])
await db.query(`select public.revise_rm($1,$2::jsonb,'reattribute',$3,null,2)`, [didA, JSON.stringify(v2content), ids.member])
assert.equal(await val(`select author_id from documents where id=$1`, [didA]), ids.member)
assert.equal(await val(`select responsible_user_id from obligations where id=$1`, [rmObA]), ids.lead)
await rejected(`select public.revise_rm($1,$2::jsonb,'bad author',$3,null,3)`, [didA, JSON.stringify(v2content), ids.pending])
assert.equal(await val(`select count(*)::int from hp_events where initiative_id=$1`, [iidA]), hpEventsBefore)

// --- revise_rm: historical --------------------------------------------
await root()
const hInit = await val(`insert into initiatives(title,summary,content,lead_id,historical_source_key)
  values('Legacy Lab','Historical record','{"blocks":[]}'::jsonb,$1,'notion:legacy:lab') returning id`, [ids.lead])
await db.query(`insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,'lead')`, [hInit, ids.lead])
const rmKey = 'notion:legacy:lab:w1:rm'
const hRm = await val(`insert into documents(kind,initiative_id,submitted_version_number,is_historical_import,historical_source_key)
  values('rm',$1,1,true,$2) returning id`, [hInit, rmKey])
const prov = {blocks: [], historical: 'true', source_key: rmKey, source_author: 'A. Historian',
  source_period: 'Spring 2024', source_week: 'Week 1', source_record_count: 2}
await db.query(`insert into document_versions(document_id,version_number,content,created_by) values($1,1,$2::jsonb,null)`,
  [hRm, JSON.stringify(prov)])
const revKey = 'notion:legacy:lab:w1:review'
const hRev = await val(`insert into documents(kind,initiative_id,reviewed_document_id,reviewed_version_number,submitted_version_number,is_historical_import,historical_source_key)
  values('review',$1,$2,1,1,true,$3) returning id`, [hInit, hRm, revKey])
await db.query(`insert into document_versions(document_id,version_number,content,created_by) values($1,1,$2::jsonb,null)`,
  [hRev, JSON.stringify({...prov, source_key: revKey, source_record_count: 3})])

// a direct second version is blocked by the trigger (no sanctioned-revision flag)
await rejected(`insert into document_versions(document_id,version_number,content,created_by) values($1,2,$2::jsonb,$3)`,
  [hRm, JSON.stringify(prov), ids.research])

await actor(ids.research)
await rejected(`select public.revise_rm($1,$2::jsonb,'x',$3,null,1)`, [hRm, JSON.stringify({blocks: []}), ids.member])
await db.query(`select public.revise_rm($1,$2::jsonb,'transcription fix',null,'Corrected Name',1)`,
  [hRm, JSON.stringify({blocks: [{t: 'p'}], html: '<p>historical fix</p>', title: 'W1 fixed'})])

const hv = (await db.query(
  `select version_number,content,created_by from document_versions where document_id=$1 order by version_number`, [hRm])).rows
assert.equal(hv.length, 2)
assert.deepEqual(hv[0].content, prov)                          // original untouched
assert.equal(hv[0].created_by, null)
assert.equal(hv[1].version_number, 2)
assert.equal(hv[1].created_by, ids.research)
assert.equal(hv[1].content.historical, 'true')                 // provenance carried forward
assert.equal(hv[1].content.source_key, rmKey)
assert.equal(hv[1].content.source_week, 'Week 1')
assert.equal(hv[1].content.source_record_count, 2)
assert.equal(hv[1].content.source_author, 'Corrected Name')    // attribution updated
assert.equal(hv[1].content.html, '<p>historical fix</p>')

const hDoc = await one(`select submitted_version_number,author_id,is_historical_import,obligation_id from documents where id=$1`, [hRm])
assert.equal(hDoc.submitted_version_number, 1)                  // documents row is left alone
assert.equal(hDoc.author_id, null)
assert.equal(hDoc.is_historical_import, true)
assert.equal(hDoc.obligation_id, null)
assert.equal(await val(`select reviewed_version_number from documents where id=$1`, [hRev]), 1)
await rejected(`select public.revise_rm($1,$2::jsonb,'x',null,'y',1)`, [hRev, JSON.stringify({blocks: []})]) // kind<>rm
assert.equal(await val(`select count(*)::int from obligations where initiative_id=$1`, [hInit]), 0)
assert.equal(await val(`select count(*)::int from hp_events where initiative_id=$1`, [hInit]), 0)

// --- initiative cover -------------------------------------------------
await actor(ids.outsider)
await rejected(`select public.set_initiative_cover($1,$2,'image/png',1000)`, [iidA, iidA + '/cover.png']) // not lead/admin
await actor(ids.lead)
await rejected(`select public.set_initiative_cover($1,$2,'image/svg+xml',1000)`, [iidA, iidA + '/cover.png']) // mime
await rejected(`select public.set_initiative_cover($1,$2,'image/png',20000000)`, [iidA, iidA + '/cover.png']) // size
await rejected(`select public.set_initiative_cover($1,'00000000-0000-4000-8000-0000000000fe/c.png','image/png',900)`, [iidA]) // folder
await db.query(`select public.set_initiative_cover($1,$2,'image/webp',500000)`, [iidA, iidA + '/cover.webp'])
assert.equal(await val(`select cover_object_path from initiatives where id=$1`, [iidA]), iidA + '/cover.webp')
await rejected(`select public.set_initiative_cover_color($1,'red')`, [iidA])
await db.query(`select public.set_initiative_cover_color($1,'#1A2B3C')`, [iidA])
assert.equal(await val(`select cover_fallback_color from initiatives where id=$1`, [iidA]), '#1A2B3C')
await db.query(`select public.clear_initiative_cover($1)`, [iidA])
assert.equal(await val(`select cover_object_path from initiatives where id=$1`, [iidA]), null)

await root()
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-covers',$1)`, [iidA + '/cover.webp'])
const coverSeen = async () => Number(await val(`select count(*)::int from storage.objects where bucket_id='initiative-covers'`))
await actor(ids.outsider); assert.equal(await coverSeen(), 1)   // covers: any approved account
await actor(ids.pending);  assert.equal(await coverSeen(), 0)   // not approved
await actor(ids.outsider)
await rejected(`insert into storage.objects(bucket_id,name) values('initiative-covers',$1)`, [iidA + '/x.png'])
await actor(ids.lead)
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-covers',$1)`, [iidA + '/lead.png'])

// --- inline RM images -----------------------------------------------
await actor(ids.outsider)
await rejected(`select public.attach_rm_image($1,$2,'image/png',1000,null,null)`, [didA, iidA + '/img1.png'])
await actor(ids.lead)
await rejected(`select public.attach_rm_image($1,$2,'image/bmp',1000,null,null)`, [didA, iidA + '/img1.png'])   // mime
await rejected(`select public.attach_rm_image($1,$2,'image/png',0,null,null)`, [didA, iidA + '/img1.png'])       // size
await rejected(`select public.attach_rm_image($1,'wrong/img.png','image/png',1000,null,null)`, [didA])            // folder
const att1 = await val(`select public.attach_rm_image($1,$2,'image/png',1234,800,600)`, [didA, iidA + '/img1.png'])
assert.equal(await val(`select mime_type from document_attachments where id=$1`, [att1]), 'image/png')
// An existing object cannot be rebound to another memo, even by Research.
await root()
await db.query(`select open_cycle('2026-03-23',false)`)
const rmObCollision = (await one(`select id from obligations where initiative_id=$1 and kind='rm' order by due_at desc limit 1`, [iidA])).id
await actor(ids.lead)
const didCollision = await val(`select public.save_document_draft($1,$2::jsonb,null)`, [rmObCollision, JSON.stringify({blocks: []})])
await actor(ids.research)
await rejected(`select public.attach_rm_image($1,$2,'image/png',1234,null,null)`, [didCollision, iidA + '/img1.png'])
await actor(ids.research)
const attH = await val(`select public.attach_rm_image($1,$2,'image/gif',2000,null,null)`, [hRm, hInit + '/hist.gif'])
assert.ok(attH)

// a second initiative with a DRAFT rm (no submitted version)
await actor(ids.lead)
const p2 = await val(`select public.save_proposal('Draft Lab','S',$1::jsonb,true,null)`, [JSON.stringify({motivation: MOTIV})])
await actor(ids.research)
const iidB = await val(`select public.decide_proposal($1,'approved','ok')`, [p2])
await root()
await db.query(`update initiatives set activated_at='2020-01-01' where id=$1`, [iidB])
await db.query(`select open_cycle('2026-03-16',false)`)
const rmObB = (await one(`select id from obligations where initiative_id=$1 and kind='rm'`, [iidB])).id
await actor(ids.lead)
const didB = await val(`select public.save_document_draft($1,$2::jsonb,null)`, [rmObB, JSON.stringify({blocks: [], html: '<p>draft</p>'})])
assert.equal(await val(`select submitted_version_number from documents where id=$1`, [didB]), null)
await db.query(`select public.attach_rm_image($1,$2,'image/png',999,null,null)`, [didB, iidB + '/draft-img.png'])

await root()
for (const n of [iidB + '/draft-img.png', iidA + '/img1.png', iidA + '/legacy.png']) {
  await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images',$1)`, [n])
}
const canSee = async (name) =>
  Number(await val(`select count(*)::int from storage.objects where bucket_id='initiative-images' and name=$1`, [name]))

// draft-RM image: team + Research yes; unrelated approved + pending no
await actor(ids.lead);     assert.equal(await canSee(iidB + '/draft-img.png'), 1)
await actor(ids.research)
assert.equal(await val(`select public.has_role('research')`), true)
assert.equal(await val(`select count(*)::int from document_attachments where object_path=$1`, [iidB + '/draft-img.png']), 1)
assert.equal(await canSee(iidB + '/draft-img.png'), 1)
await actor(ids.outsider); assert.equal(await canSee(iidB + '/draft-img.png'), 0)
await actor(ids.pending);  assert.equal(await canSee(iidB + '/draft-img.png'), 0)
// submitted-RM image: any approved account
await actor(ids.outsider); assert.equal(await canSee(iidA + '/img1.png'), 1)
await actor(ids.pending);  assert.equal(await canSee(iidA + '/img1.png'), 0)
// object with no attachment row: falls back to the per-initiative membership rule
await actor(ids.outsider); assert.equal(await canSee(iidA + '/legacy.png'), 0)
await actor(ids.lead);     assert.equal(await canSee(iidA + '/legacy.png'), 1)

// Historical image integrity: detach deletes the bytes, so it must refuse while
// any stored version still displays them. An imported version 1 is immutable and
// could never be repaired, so this is the guard that keeps a revision from
// destroying the image an older version renders.
await root()
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images',$1)`, [hInit + '/hist.gif'])
await actor(ids.research)
const hLast = Number(await val(`select coalesce(max(version_number),0)::int from document_versions where document_id=$1`, [hRm]))
await db.query(`select public.revise_rm($1,$2::jsonb,'embed the recovered scan',null,null,$3)`,
  [hRm, JSON.stringify({blocks: [{t: 'img'}], html: `<p><img data-object-path="${hInit}/hist.gif" src=""></p>`}), hLast])
await rejected(`select public.detach_rm_image($1)`, [attH])
await root()
assert.equal(await val(`select count(*)::int from document_attachments where id=$1`, [attH]), 1)
assert.equal(await val(`select count(*)::int from storage.objects where bucket_id='initiative-images' and name=$1`, [hInit + '/hist.gif']), 1)
// The imported version 1 is still exactly as the canonical import wrote it.
assert.equal(await val(`select created_by is null from document_versions where document_id=$1 and version_number=1`, [hRm]), true)

// Detach of an unreferenced object removes the object as well as its metadata,
// so it cannot fall back to the broader legacy policy.
await actor(ids.research)
await db.query(`select public.detach_rm_image((select id from document_attachments where object_path=$1))`, [iidB + '/draft-img.png'])
assert.equal(await val(`select count(*)::int from document_attachments where object_path=$1`, [iidB + '/draft-img.png']), 0)
await root(); assert.equal(await canSee(iidB + '/draft-img.png'), 0)
await actor(ids.outsider); assert.equal(await canSee(iidB + '/draft-img.png'), 0)

await db.close()
console.log('PASS: motivation gate (submit + approve, drafts exempt, re-approve unaffected),')
console.log('      revise_rm Research-only + append-only + optimistic version check + no HP/obligation/review change,')
console.log('      historical v1 & provenance immutable, cover approved-audience + lead/admin writes,')
console.log('      inline images submitted->approved / draft->editors+Research, MIME/size bounds, no rebind/fallback,')
console.log('      detach refuses while a stored version still displays the image.')
