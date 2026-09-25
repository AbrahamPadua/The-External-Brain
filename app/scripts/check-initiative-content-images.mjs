// Offline rich initiative editing and storage permissions. Run from app/.
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
const iid = (await val(`insert into initiatives(title,summary,lead_id) values('Rich initiative','An existing abstract for our study',$1) returning id`, [ids.lead])).id
await db.query('insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,\'member\')', [iid, ids.member])
await db.exec('grant insert,update,delete on storage.objects to authenticated')
const image = `${iid}/sample.png`
const insertImage = 'insert into storage.objects(bucket_id,name) values(\'initiative-content-images\',$1)'
await actor(ids.operations)
await assert.rejects(db.query(insertImage, [image]), /row-level security/)
await actor(ids.pending)
await assert.rejects(db.query(insertImage, [image]), /row-level security/)
await actor(ids.member)
await db.query(insertImage, [image])
const html = `<p>A <strong>formatted</strong> abstract with enough text.</p><p>Next paragraph.</p><img data-object-path="${image}" src="">`
const motivation = '<p>Motivation with <em>formatting</em>.</p>'
const edit = 'select update_initiative_content($1,$2,$3,$4,$5)'
const args = [iid, 'Rich initiative', 'Engineering', html, motivation]
await db.query(edit, args)
let row = await val('select summary,content from initiatives where id=$1', [iid])
assert.equal(row.content.abstract_html, html)
assert.equal(row.content.motivation_html, motivation)
assert.equal(row.summary, 'A formatted abstract with enough text.\n\nNext paragraph.')
assert.equal(row.content.motivation, 'Motivation with formatting.')
await assert.rejects(db.query(edit, [iid, args[1], args[2], html.replace(image, `${iid}/missing.png`), motivation]), /image must be uploaded/)
await assert.rejects(db.query(edit, [iid, args[1], args[2], html.replace(image, `${ids.operations}/foreign.png`), motivation]), /image must be uploaded/)
await assert.rejects(db.query(edit, [iid, args[1], args[2], html.replace('src=""', 'src="data:image/png;base64,aGVsbG8="'), motivation]), /temporary image data/)
await assert.rejects(db.query(edit, [iid, args[1], args[2], 'x'.repeat(100001), motivation]), /100000/)
assert.equal((await db.query('delete from storage.objects where name=$1 returning name', [image])).rows.length, 0)
assert.equal((await db.query('update storage.objects set name=$1 where name=$2 returning name', [`${iid}/changed.png`, image])).rows.length, 0)
await actor(ids.operations)
assert.equal((await db.query('select name from storage.objects where name=$1', [image])).rows.length, 1, 'approved reader sees overview pictures')
await assert.rejects(db.query(edit, args), /initiative member or Research required/)
await actor(ids.pending)
assert.equal((await db.query('select name from storage.objects where name=$1', [image])).rows.length, 0)
await owner()
await db.exec('set role anon')
await assert.rejects(db.query('select name from storage.objects where name=$1', [image]), /permission denied/)
await actor(ids.research)
await db.query(edit, args)
await db.query(insertImage, [`${iid}/research.png`])
await owner()
await db.query('update initiative_memberships set left_at=now() where initiative_id=$1 and user_id=$2', [iid, ids.member])
await actor(ids.member)
await assert.rejects(db.query(insertImage, [`${iid}/former.png`]), /row-level security/)
await assert.rejects(db.query(edit, args), /initiative member or Research required/)
await actor(ids.lead)
await db.query('select update_initiative_details($1,$2,$3,$4,$5,$6)', [iid, args[1], 'Legacy client plain text update', args[2], 'Updated motivation', ''])
row = await val('select summary,content from initiatives where id=$1', [iid])
assert.equal(row.content.abstract_html, '')
assert.equal(row.content.motivation_html, '')
await db.close()
console.log('PASS: rich content/newlines and image references persist; member/Research uploads; approved reads only; outsider/former-member writes and cross-initiative/missing images rejected; old clients clear stale rich content.')
