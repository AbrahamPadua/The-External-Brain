/**
 * 202609100008 member profiles: authorization and validation checks.
 *
 * Runs the real migrations against a throwaway in-process Postgres (PGlite) with
 * a synthetic auth schema, exactly like check-database.mjs, and exercises the
 * two things this feature must never get wrong:
 *   * a member may edit their OWN name / major / interests and nothing else -
 *     not another member's row, not their account status, not their roles, not
 *     their sign-in email; and
 *   * the signup details are normalised and bounded, on the way in through the
 *     auth trigger and on the way in through update_my_profile.
 *
 * Every account and email below is synthetic. Run from app/:  node scripts/check-profile.mjs
 */
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
for (const file of readdirSync('../supabase/migrations').filter((x) => x.endsWith('.sql')).sort()) {
  await db.exec(readFileSync('../supabase/migrations/' + file, 'utf8').replace('create extension if not exists pgcrypto;', ''))
}

const ids = {
  admin: '00000000-0000-4000-8000-000000000001',
  alice: '00000000-0000-4000-8000-000000000002',
  bob: '00000000-0000-4000-8000-000000000003',
  noisy: '00000000-0000-4000-8000-000000000004',
}
const signup = (id, email, meta) =>
  db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, email, meta])
const profile = async (id) => (await db.query('select * from public.profiles where id=$1', [id])).rows[0]
const actor = async (id, role = 'authenticated') => {
  await db.exec('reset role')
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', id ?? ''])
  await db.exec(`set role ${role}`)
}
const rejected = (sql, params = []) => assert.rejects(db.query(sql, params))
const update = (name, major = null, interests = null) =>
  db.query('select public.update_my_profile($1,$2,$3)', [name, major, interests])

// --- signup metadata lands on the profile ----------------------------------
// The magic-link metadata is user-controlled, so the trigger takes the three
// display fields, normalises them and truncates: an oversized payload must not
// be able to block a signup, and it must not be able to set a status or a role.
await signup(ids.admin, 'admin@example.test', { display_name: 'Ops Admin' })
await signup(ids.alice, 'alice@example.test', {
  display_name: '  Ada\t\tLovelace \n',
  major: ' Cognitive   Science ',
  interests: 'Spatial audio,\nassistive technology',
  account_status: 'approved',
  role: 'operations',
})
await signup(ids.bob, 'bob@example.test', {})
await signup(ids.noisy, 'noisy@example.test', {
  display_name: 'x'.repeat(200), major: 'y'.repeat(200), interests: 'z'.repeat(400),
})

const ada = await profile(ids.alice)
assert.equal(ada.display_name, 'Ada Lovelace')
assert.equal(ada.major, 'Cognitive Science')
assert.equal(ada.interests, 'Spatial audio, assistive technology')
assert.equal(ada.account_status, 'pending', 'signup metadata must never set the account status')
assert.equal((await db.query('select count(*)::int c from public.role_grants')).rows[0].c, 0)

const noisy = await profile(ids.noisy)
assert.equal(noisy.display_name.length, 80)
assert.equal(noisy.major.length, 80)
assert.equal(noisy.interests.length, 280)

// An account created before this feature existed: no name, no details, still a
// usable row.
const legacy = await profile(ids.bob)
assert.equal(legacy.display_name, '')
assert.equal(legacy.major, '')
assert.equal(legacy.interests, '')

await db.exec(`update public.profiles set account_status='approved' where id='${ids.admin}';
 insert into public.role_grants(user_id,role,granted_by) values('${ids.admin}','operations','${ids.admin}'),('${ids.admin}','research','${ids.admin}');`)

// --- who may call it -------------------------------------------------------
// The RPC takes no target user, so there is nothing to point at someone else.
const fn = (await db.query(`select pronargs, pg_get_function_arguments(oid) args
 from pg_proc where proname='update_my_profile'`)).rows[0]
assert.equal(fn.pronargs, 3)
assert.ok(!/user|uid|status|role|email/i.test(fn.args), `unexpected argument: ${fn.args}`)
assert.equal((await db.query(
  `select has_function_privilege('anon','public.update_my_profile(text,text,text)','execute') p`)).rows[0].p, false)
assert.equal((await db.query(
  `select has_function_privilege('authenticated','public.update_my_profile(text,text,text)','execute') p`)).rows[0].p, true)

// anon is refused by privilege, and a session without a subject is refused by
// the function itself.
await actor(ids.alice, 'anon')
await rejected(`select public.update_my_profile('Forged Name')`)
await actor(null)
await rejected(`select public.update_my_profile('Forged Name')`)

// --- a pending account edits its own details -------------------------------
await actor(ids.alice)
await update('Ada  Lovelace', 'Neuroscience', 'Spatial audio')
let row = await profile(ids.alice)
assert.equal(row.display_name, 'Ada Lovelace')
assert.equal(row.major, 'Neuroscience')
assert.equal(row.interests, 'Spatial audio')
assert.equal(row.account_status, 'pending', 'editing a profile must not approve it')
assert.equal((await db.query('select public.is_approved() a')).rows[0].a, false)
assert.equal((await db.query(`select public.has_role('operations') r`)).rows[0].r, false)
await db.exec('reset role')
assert.equal((await db.query('select email from auth.users where id=$1', [ids.alice])).rows[0].email,
  'alice@example.test', 'the sign-in email is not writable from the profile RPC')
await actor(ids.alice)

// null leaves a field alone; '' clears it.
await update('Ada Lovelace')
row = await profile(ids.alice)
assert.equal(row.major, 'Neuroscience')
assert.equal(row.interests, 'Spatial audio')
await update('Ada Lovelace', '', 'Spatial audio')
assert.equal((await profile(ids.alice)).major, '')

// Control characters and runs of whitespace collapse: these are single-line
// fields and a pasted newline must not survive into them.
await update(' \n Ada\r\n Lovelace \t', 'Cognitive\tScience', 'Audio,\n\n memory')
row = await profile(ids.alice)
assert.equal(row.display_name, 'Ada Lovelace')
assert.equal(row.major, 'Cognitive Science')
assert.equal(row.interests, 'Audio, memory')

// --- validation ------------------------------------------------------------
for (const bad of ['', '   ', '\n\t', 'A', ' A ']) {
  await rejected('select public.update_my_profile($1,null,null)', [bad])
}
await rejected('select public.update_my_profile($1,null,null)', ['a'.repeat(81)])
await rejected('select public.update_my_profile($1,$2,null)', ['Ada Lovelace', 'm'.repeat(81)])
await rejected('select public.update_my_profile($1,null,$2)', ['Ada Lovelace', 'i'.repeat(281)])
// The boundaries themselves are accepted.
await update('a'.repeat(80), 'm'.repeat(80), 'i'.repeat(280))
row = await profile(ids.alice)
assert.equal(row.display_name.length, 80)
assert.equal(row.interests.length, 280)
await update('Ada Lovelace', 'Cognitive Science', 'Spatial audio')

// --- nothing else is reachable ---------------------------------------------
// profiles stays RPC-only for writes: 202609090004 revoked table writes and no
// update policy has existed since 202609090003.
await rejected(`update public.profiles set account_status='approved' where id=$1`, [ids.alice])
await rejected(`update public.profiles set display_name='Hijacked' where id=$1`, [ids.bob])
await rejected(`insert into public.role_grants(user_id,role,granted_by) values($1,'operations',$1)`, [ids.alice])
// The approval workflow is untouched: a pending account still cannot act, and
// still cannot decide itself.
await rejected(`select public.save_proposal('Forged','Summary','{}',true,null)`)
await rejected(`select public.decide_account($1,'approved','self')`, [ids.alice])
// Another member's row was never in reach.
await db.exec('reset role')
assert.equal((await profile(ids.bob)).display_name, '')

// --- an account that predates the feature still works ----------------------
await actor(ids.bob)
assert.equal((await db.query('select count(*)::int c from public.profiles')).rows[0].c, 1,
  'a pending account sees only its own profile')
await update('Bob Reyes', 'Bioengineering', '')
assert.equal((await profile(ids.bob)).display_name, 'Bob Reyes')

// --- approval still belongs to Operations / Research -----------------------
await actor(ids.admin)
await db.query(`select public.decide_account($1,'approved','reviewed')`, [ids.alice])
await db.query(`select public.decide_account($1,'approved','reviewed')`, [ids.bob])
await actor(ids.alice)
// Approved members read each other's details - major and interests are
// directory information, exactly like the display name.
const seen = (await db.query('select display_name,major from public.profiles order by display_name')).rows
assert.deepEqual(seen.map((p) => p.display_name), ['Ada Lovelace', 'Bob Reyes', 'Ops Admin'])
assert.equal(seen[1].major, 'Bioengineering')
// A suspended account may still correct its own details, and stays suspended.
await actor(ids.admin)
await db.query(`select public.decide_account($1,'suspended','synthetic test')`, [ids.alice])
await actor(ids.alice)
await update('Ada Lovelace', 'Cognitive Science', 'Spatial audio')
assert.equal((await profile(ids.alice)).account_status, 'suspended')
await rejected(`select public.save_proposal('Forged','Summary','{}',true,null)`)

// --- the audit trail records the edit, not its contents --------------------
await db.exec('reset role')
const events = (await db.query(`select actor_id,detail from public.audit_events
 where action='profile_updated' order by created_at`)).rows
assert.ok(events.length >= 2)
assert.ok(events.every((e) => e.actor_id === ids.alice || e.actor_id === ids.bob))
assert.deepEqual(Object.keys(events[0].detail).sort(), ['interests_set', 'major_set'])

await db.close()
console.log('PASS: signup metadata normalised and bounded, self-only profile edit, no status/role/email escalation,')
console.log('      pending and legacy accounts editable, approval gate and RPC-only writes intact.')
