// Offline abstract promotion and member permissions. Run from app/.
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
for (const file of readdirSync('../supabase/migrations').filter(x => x.endsWith('.sql') && !x.includes('020_') && !x.includes('021_')).sort()) {
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
const html = '<p>Renamed to â€œAURORAâ€ &amp; Iâ€™m ready.</p><p>Second line<br>Third line &#x2014; &#8217;</p>'
const iid = (await val(`insert into initiatives(title,summary,content,lead_id)
 values('Example initiative','Old short abstract',$1::jsonb,$2) returning id`,
 [JSON.stringify({html, motivation: 'Why weâ€™re here', source_key: 'keep-me'}), ids.lead])).id
const empty = (await val(`insert into initiatives(title,summary,content,lead_id)
 values('Without overview','Keep this existing abstract','{}',$1) returning id`, [ids.lead])).id
await db.query('insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,\'member\')', [iid, ids.member])
const migration = readFileSync('../supabase/migrations/202609250020_initiative_abstract.sql', 'utf8')
await db.exec(migration)
let row = await val('select summary,content from initiatives where id=$1', [iid])
assert.equal(row.summary, 'Renamed to “AURORA” & I’m ready.\n\nSecond line\nThird line — ’')
assert.equal(row.content.motivation, 'Why we’re here')
assert.equal(row.content.html, '')
assert.equal(row.content.abstract_promotion_backup.html, html)
assert.equal(row.content.abstract_promotion_backup.summary, 'Old short abstract')
assert.equal(row.content.source_key, 'keep-me')
assert.equal((await val('select summary from initiatives where id=$1', [empty])).summary, 'Keep this existing abstract')
const saved = structuredClone(row)
await db.exec(migration)
assert.deepEqual(await val('select summary,content from initiatives where id=$1', [iid]), saved)
const edit = 'select update_initiative_details($1,$2,$3,$4,$5,$6)'
const abstract = 'First paragraph.\n\nSecond paragraph.\n' + 'Long overview text. '.repeat(200).trim()
const args = [iid, 'Updated initiative', abstract, 'Research', 'Motivation', '']
await actor(ids.member)
await db.query(edit, args)
assert.equal((await val('select summary from initiatives where id=$1', [iid])).summary, abstract)
await assert.rejects(db.query(edit, [iid, args[1], 'x'.repeat(100001), ...args.slice(3)]), /abstract must be/)
await actor(ids.lead)
await db.query(edit, args)
await actor(ids.research)
await db.query(edit, args)
await actor(ids.pending)
await assert.rejects(db.query(edit, args), /approved account required/)
await actor(ids.operations)
await assert.rejects(db.query(edit, args), /initiative member or Research required/)
await owner()
await db.query('insert into role_grants(user_id,role,granted_by) values($1,\'admin\',$1)', [ids.operations])
await actor(ids.operations)
await assert.rejects(db.query(edit, args), /initiative member or Research required/)
await owner()
await db.query('update initiative_memberships set left_at=now() where initiative_id=$1 and user_id=$2', [iid, ids.member])
await actor(ids.member)
await assert.rejects(db.query(edit, args), /initiative member or Research required/)
await owner()
await db.exec(migration)
row = await val('select summary,content from initiatives where id=$1', [iid])
assert.equal(row.summary, abstract)
assert.deepEqual(row.content.abstract_promotion_backup, saved.content.abstract_promotion_backup)
await db.close()
console.log('PASS: overview promotion, punctuation, entities/newlines, backups, repeat safety, long abstracts, member/Research access and rejected outsiders/former members.')
