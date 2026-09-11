// Offline contract check for 202609100011. Run from app/:
//   node scripts/check-canonical-historical-schema.mjs
import {PGlite} from '@electric-sql/pglite'
import {readFileSync,readdirSync} from 'node:fs'
import assert from 'node:assert/strict'

const db=new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 grant usage on schema storage to anon,authenticated; grant select on storage.objects to anon,authenticated;`)
for(const file of readdirSync('../supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){
  const sql=readFileSync('../supabase/migrations/'+file,'utf8').replace('create extension if not exists pgcrypto;','')
  await db.exec(sql)
}

const lead='00000000-0000-4000-8000-000000000099'
await db.query('insert into auth.users(id) values($1)',[lead])
await db.query(`update profiles set account_status='approved' where id=$1`,[lead])
const initiative=(await db.query(
  `insert into initiatives(title,summary,content,lead_id,historical_source_key)
   values('Imported pilot','Historical Notion record','{"blocks":[]}', $1, 'notion:initiative:pilot') returning id`,[lead]
)).rows[0].id
await db.query(`insert into initiative_memberships(initiative_id,user_id,role) values($1,$2,'lead')`,[initiative,lead])

const content=(sourceKey,recordCount)=>({
  blocks:[], historical:true, source_key:sourceKey, source_author:null,
  source_period:'Spring 2024', source_week:'Week 1', source_record_count:recordCount,
})
const rmKey='notion:initiative:pilot:week:01:rm'
const rm=(await db.query(
  `insert into documents(kind,initiative_id,submitted_version_number,is_historical_import,historical_source_key)
   values('rm',$1,1,true,$2) returning id`,[initiative,rmKey]
)).rows[0].id
await db.query(
  `insert into document_versions(document_id,version_number,content,created_by) values($1,1,$2,null)`,[rm,content(rmKey,2)]
)
const reviewKey='notion:initiative:pilot:week:01:review'
const review=(await db.query(
  `insert into documents(kind,initiative_id,reviewed_document_id,reviewed_version_number,submitted_version_number,is_historical_import,historical_source_key)
   values('review',$1,$2,1,1,true,$3) returning id`,[initiative,rm,reviewKey]
)).rows[0].id
await db.query(
  `insert into document_versions(document_id,version_number,content,created_by) values($1,1,$2,null)`,[review,content(reviewKey,3)]
)

const count=async(sql,params=[]) => (await db.query(sql,params)).rows[0].c
assert.equal(await count(`select count(*)::int c from obligations where initiative_id=$1`,[initiative]),0)
const storedReview=(await db.query(`select reviewed_document_id,reviewed_version_number,obligation_id,author_id from documents where id=$1`,[review])).rows[0]
assert.equal(storedReview.reviewed_document_id,rm)
assert.equal(storedReview.reviewed_version_number,1)
assert.equal(storedReview.obligation_id,null)
assert.equal(storedReview.author_id,null)
assert.equal((await db.query(`select submitted_at from document_versions where document_id=$1`,[rm])).rows[0].submitted_at,null)
await assert.rejects(db.query(
  `insert into document_versions(document_id,version_number,content,created_by) values($1,2,$2,null)`,[rm,content(rmKey,2)]
))
await assert.rejects(db.query(`update documents set submitted_version_number=2 where id=$1`,[rm]))

// This is a future, live cycle: it creates the normal unique RM/review pair
// for the canonical initiative without repurposing its historical documents.
await db.query(`select set_config('request.jwt.claim.role','service_role',false)`)
await db.query(`select open_cycle('2030-01-07',false)`)
assert.equal(await count(`select count(*)::int c from obligations where initiative_id=$1`,[initiative]),2)
assert.equal(await count(`select count(*)::int c from obligations where initiative_id=$1 and kind='rm'`,[initiative]),1)
assert.equal(await count(`select count(*)::int c from obligations where initiative_id=$1 and kind='review'`,[initiative]),1)

await db.close()
console.log('PASS: canonical historical RM/review linkage, no fabricated live history, immutable provenance, future live cycle.')
