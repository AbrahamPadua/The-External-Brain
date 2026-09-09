import { PGlite } from '@electric-sql/pglite'
import { readFileSync,readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
const db=new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role;
 create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
 grant usage on schema auth to anon,authenticated,service_role; grant execute on all functions in schema auth to anon,authenticated,service_role;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;`)
for(const file of readdirSync('../supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){
 const sql=readFileSync('../supabase/migrations/'+file,'utf8').replace('create extension if not exists pgcrypto;','')
 await db.exec(sql)
 console.log('Applied',file)
}
const ids={admin:'00000000-0000-4000-8000-000000000001',lead:'00000000-0000-4000-8000-000000000002',pending:'00000000-0000-4000-8000-000000000003',member:'00000000-0000-4000-8000-000000000004'}
for(const id of Object.values(ids))await db.query('insert into auth.users(id) values($1)',[id])
await db.exec(`update profiles set account_status='approved' where id<>'${ids.pending}'; insert into role_grants(user_id,role,granted_by) values('${ids.admin}','operations','${ids.admin}'),('${ids.admin}','research','${ids.admin}');`)
async function actor(id){await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);await db.exec(`set role authenticated;`)}
async function rejected(sql,params=[]){await assert.rejects(db.query(sql,params))}
await actor(ids.pending)
await rejected(`select public.save_proposal('forged','summary','{}',true,null)`)
assert.equal((await db.query('select * from profiles')).rows.length,1)
await rejected(`select public.decide_account($1,'approved','self')`,[ids.pending])
await actor(ids.admin)
await db.query(`select decide_account($1,'approved','reviewed')`,[ids.pending])
await actor(ids.lead)
const pid=(await db.query(`select save_proposal('Pilot','Summary','{}',true,null) id`)).rows[0].id
await actor(ids.admin)
const iid=(await db.query(`select decide_proposal($1,'approved','ready') id`,[pid])).rows[0].id
assert.equal((await db.query(`select decide_proposal($1,'approved','retry') id`,[pid])).rows[0].id,iid)
await db.exec('reset role')
await db.query(`update initiatives set activated_at='2020-01-01' where id=$1`,[iid])
await actor(ids.admin)
await db.query(`select open_cycle('2026-03-09',false)`)
const obligations=(await db.query('select * from obligations')).rows
const rm=obligations.find(x=>x.kind==='rm'),review=obligations.find(x=>x.kind==='review')
assert.equal(new Date(rm.due_at).toISOString(),'2026-03-14T06:59:00.000Z')
assert.equal(new Date(review.due_at).toISOString(),'2026-03-16T06:59:00.000Z')
await db.query(`select evaluate_due_obligations()`)
await db.query(`select evaluate_due_obligations()`)
assert.equal((await db.query(`select hp_balance($1) hp`,[iid])).rows[0].hp,90)
assert.equal((await db.query(`select * from hp_events where kind='penalty'`)).rows.length,1)
await actor(ids.lead)
const content={html:'<p>Progress</p>',blocks:[]}
const did=(await db.query(`select save_document_draft($1,$2,null) id`,[rm.id,content])).rows[0].id
await rejected('select save_document_draft($1,$2,99)',[rm.id,content])
await actor(ids.member)
assert.equal((await db.query('select * from documents')).rows.length,0)
await rejected('select submit_obligation($1,$2,null,null)',[rm.id,content])
await actor(ids.lead)
await db.query('select submit_obligation($1,$2,null,null)',[rm.id,content])
await db.query('select submit_obligation($1,$2,null,null)',[rm.id,content])
assert.equal((await db.query('select hp_balance($1) hp',[iid])).rows[0].hp,100)
assert.equal((await db.query('select * from document_versions where document_id=$1',[did])).rows.length,1)
await actor(ids.member)
assert.equal((await db.query('select * from documents')).rows.length,1)
await db.query(`select add_comment($1,1,'block-1','Useful',null,null,'Progress')`,[did])
await actor(ids.admin)
await db.query(`select decide_account($1,'suspended','access test')`,[ids.member])
await actor(ids.member)
assert.equal((await db.query('select * from documents')).rows.length,0)
await rejected(`select add_comment($1,1,'block-1','Forbidden',null,null,'Progress')`,[did])
await db.close()
console.log('PASS: approval gate, private drafts, submitted visibility, deadlines, idempotency, late HP, suspension.')
