// Offline contract check for 202609110017. Run from app/:
//   node scripts/check-task-images.mjs
//
// Covers task-description images (authorised attach, read audience, refusal to
// destroy a referenced image, cleanup on delete) and version-anchored Roast Me
// highlights, and re-checks that the 202609100012 image rules still hold.
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

await root()
const ini = await val(`insert into initiatives(title,summary,content,lead_id)
  values('Spatial Sound','Summary','{"blocks":[]}'::jsonb,$1) returning id`, [ids.lead])
await db.query(`insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,'lead')`, [ini, ids.lead])
await db.query(`insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,'member')`, [ini, ids.member])

// --- task description images ----------------------------------------------
await actor(ids.lead)
const task = await val(`select public.create_task($1,'Document the prototype','<p>Notes.</p>',null,null,'planned')`, [ini])
assert.ok(task)
// The cap is sized for markup now, and still a cap.
await db.query(`select public.update_task($1,'Document the prototype',$2,null,null,'planned')`,
  [task, '<p>' + 'x'.repeat(5000) + '</p>'])
await rejected(`select public.update_task($1,'Document the prototype',$2,null,null,'planned')`,
  [task, 'x'.repeat(8001)])

const okPath = ini + '/shot.png'
await rejected(`select public.attach_task_image($1,$2,'image/svg+xml',100,null,null)`, [task, okPath])
await rejected(`select public.attach_task_image($1,$2,'image/png',0,null,null)`, [task, okPath])
await rejected(`select public.attach_task_image($1,$2,'image/png',20000000,null,null)`, [task, okPath])
await rejected(`select public.attach_task_image($1,'somewhere-else/shot.png','image/png',100,null,null)`, [task])
const attachment = await val(`select public.attach_task_image($1,$2,'image/png',1234,800,600)`, [task, okPath])
assert.ok(attachment)
assert.equal(await val(`select mime_type from task_attachments where id=$1`, [attachment]), 'image/png')
// Re-registering the same path for the same task updates rather than duplicating.
assert.equal(await val(`select public.attach_task_image($1,$2,'image/png',4321,null,null)`, [task, okPath]), attachment)
assert.equal(await val(`select count(*)::int from task_attachments`), 1)

// Only whoever may edit the description may attach to it.
await actor(ids.member)
await rejected(`select public.attach_task_image($1,$2,'image/png',100,null,null)`, [task, ini + '/b.png'])
await actor(ids.outsider)
await rejected(`select public.attach_task_image($1,$2,'image/png',100,null,null)`, [task, ini + '/b.png'])
await actor(ids.pending)
await rejected(`select public.attach_task_image($1,$2,'image/png',100,null,null)`, [task, ini + '/b.png'])
// is_admin() has covered Research since 202609090001, and 202609110014 already
// admitted an admin to task editing, so Research can attach here too. The point
// of the check is that the boundary is unchanged, not that it is narrower.
await actor(ids.research)
assert.equal(await val(`select public.can_edit_task($1)`, [task]), true)
assert.equal(await val(`select public.can_edit_task($1)`, [task]),
  await val(`select public.is_admin()`))

// --- read audience ---------------------------------------------------------
await root()
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images',$1)`, [okPath])
const sees = async (name) => Number(await val(
  `select count(*)::int from storage.objects where bucket_id='initiative-images' and name=$1`, [name]))
// A task is readable by any approved account, so its images are too - and no wider.
for (const who of [ids.lead, ids.member, ids.outsider, ids.research]) {
  await actor(who)
  assert.equal(await sees(okPath), 1, `approved account ${who} should see a task image`)
}
await actor(ids.pending)
assert.equal(await sees(okPath), 0)

// --- detach protects a referenced image ------------------------------------
await actor(ids.lead)
await db.query(`select public.update_task($1,'Document the prototype',$2,null,null,'planned')`,
  [task, `<p><img src="" data-object-path="${okPath}"></p>`])
await assert.rejects(db.query(`select public.detach_task_image($1)`, [attachment]), /still shows/)
await root()
assert.equal(await sees(okPath), 1)
await actor(ids.lead)
await db.query(`select public.update_task($1,'Document the prototype','<p>No image.</p>',null,null,'planned')`, [task])
await db.query(`select public.detach_task_image($1)`, [attachment])
assert.equal(await val(`select count(*)::int from task_attachments where id=$1`, [attachment]), 0)
await root()
assert.equal(await sees(okPath), 0, 'detaching an unreferenced image removes the bytes')

// --- deleting a task takes its images with it ------------------------------
await actor(ids.lead)
const second = await val(`select public.create_task($1,'Second task','',null,null,'planned')`, [ini])
const secondPath = ini + '/second.png'
await db.query(`select public.attach_task_image($1,$2,'image/png',500,null,null)`, [second, secondPath])
await root()
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images',$1)`, [secondPath])
await actor(ids.lead)
await db.query(`select public.delete_task($1)`, [second])
await root()
assert.equal(await val(`select count(*)::int from task_attachments where object_path=$1`, [secondPath]), 0)
assert.equal(await sees(secondPath), 0, 'deleting a task removes its image objects')

// --- a Roast Me image and a task image cannot share one object -------------
const cycleStart = '2030-01-07'
const cycle = await val(`insert into cycles(starts_on,rm_due_at,review_due_at)
  values($1,$2,$3) returning id`, [cycleStart, cycleStart + 'T23:59:00Z', '2030-01-09T23:59:00Z'])
const obligation = await val(`insert into obligations(cycle_id,initiative_id,kind,responsible_user_id,due_at)
  values($1,$2,'rm',$3,$4) returning id`, [cycle, ini, ids.lead, cycleStart + 'T23:59:00Z'])
const rm = await val(`insert into documents(obligation_id,kind,initiative_id,author_id,submitted_version_number)
  values($1,'rm',$2,$3,1) returning id`, [obligation, ini, ids.lead])
const rmBody = 'The pilot ran twice. Results were mixed.'
await db.query(`insert into document_versions(document_id,version_number,content,submitted_at,created_by)
  values($1,1,$2::jsonb,now(),$3)`, [rm, JSON.stringify({ blocks: [], html: `<p>${rmBody}</p>` }), ids.lead])
await actor(ids.lead)
const sharedPath = ini + '/shared.png'
await db.query(`select public.attach_rm_image($1,$2,'image/png',700,null,null)`, [rm, sharedPath])
await assert.rejects(db.query(`select public.attach_task_image($1,$2,'image/png',700,null,null)`, [task, sharedPath]),
  /already attached to a Roast Me/)

// --- 202609100012 Roast Me image audience is unchanged --------------------
await root()
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images',$1)`, [sharedPath])
// Attached to a submitted Roast Me: every approved account, as before.
for (const who of [ids.outsider, ids.research]) {
  await actor(who)
  assert.equal(await sees(sharedPath), 1)
}
await actor(ids.pending)
assert.equal(await sees(sharedPath), 0)

// --- version-anchored highlights ------------------------------------------
await actor(ids.member)
const start = rmBody.indexOf('ran twice')
const quote = 'ran twice'
const thread = await val(`select public.add_anchored_comment($1,1,$2,$3,$4,'Say how it was measured.')`,
  [rm, quote, start, start + quote.length])
assert.ok(thread)
const stored = await one(`select version_number, block_id, quote, anchor_start, anchor_end
  from comment_threads where id=$1`, [thread])
assert.equal(stored.version_number, 1)
assert.equal(stored.block_id, 'selection')
assert.equal(stored.quote, quote)
assert.equal(stored.anchor_start, start)
assert.equal(stored.anchor_end, start + quote.length)
assert.equal(await val(`select count(*)::int from comments where thread_id=$1`, [thread]), 1)

// A range that does not describe the passage it claims is refused.
await assert.rejects(db.query(`select public.add_anchored_comment($1,1,$2,$3,$4,'x')`,
  [rm, quote, start, start + 99]), /does not match/)
await rejected(`select public.add_anchored_comment($1,1,'','0','4','x')`, [rm])
await rejected(`select public.add_anchored_comment($1,1,$2,-1,8,'x')`, [rm, quote])
await rejected(`select public.add_anchored_comment($1,1,$2,$3,$4,'')`, [rm, quote, start, start + quote.length])
// Only a submitted version can be anchored to, and only by an account that may read it.
await rejected(`select public.add_anchored_comment($1,9,$2,$3,$4,'x')`, [rm, quote, start, start + quote.length])
await actor(ids.pending)
await rejected(`select public.add_anchored_comment($1,1,$2,$3,$4,'x')`, [rm, quote, start, start + quote.length])
// The stored version itself is untouched by commenting on it.
await root()
assert.equal(await val(`select content->>'html' from document_versions where document_id=$1 and version_number=1`, [rm]),
  `<p>${rmBody}</p>`)

await db.close()
console.log('PASS: task images (authorised attach, approved-only read, referenced-image protection,')
console.log('      delete cleanup, no cross-binding), raised description bound,')
console.log('      version-anchored highlights with range validation, Roast Me audience unchanged.')
