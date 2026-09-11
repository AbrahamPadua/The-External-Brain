import { PGlite } from '@electric-sql/pglite'
import { readFileSync,readdirSync } from 'node:fs'
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
 console.log('Applied',file)
}
const ids={admin:'00000000-0000-4000-8000-000000000001',lead:'00000000-0000-4000-8000-000000000002',pending:'00000000-0000-4000-8000-000000000003',member:'00000000-0000-4000-8000-000000000004'}
for(const id of Object.values(ids))await db.query('insert into auth.users(id) values($1)',[id])
await db.exec(`update profiles set account_status='approved' where id<>'${ids.pending}'; insert into role_grants(user_id,role,granted_by) values('${ids.admin}','admin','${ids.admin}');`)
// 202609100007: a probe object so the initiative-images policy can be exercised from the first actor on.
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images','00000000-0000-4000-8000-0000000000ff/probe.png')`)
async function actor(id){await db.exec('reset role');await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[id]);await db.exec(`set role authenticated;`)}
async function rejected(sql,params=[]){await assert.rejects(db.query(sql,params))}
await actor(ids.pending)
await rejected('select * from public.admin_account_emails()')
assert.equal((await db.query('select * from storage.objects')).rows.length,0)
await rejected(`select public.save_proposal('forged','summary','{}',true,null)`)
assert.equal((await db.query('select * from profiles')).rows.length,1)
await rejected(`select public.decide_account($1,'approved','self')`,[ids.pending])
await actor(ids.admin)
assert.equal((await db.query(`select public.has_role('operations') r`)).rows[0].r, true)
assert.equal((await db.query(`select public.has_role('research') r`)).rows[0].r, true)
assert.equal((await db.query('select * from public.admin_account_emails()')).rows.length,4)
await db.query(`select decide_account($1,'approved','reviewed')`,[ids.pending])
await actor(ids.lead)
await rejected('select * from public.admin_account_emails()')
const motivation=Array.from({length:150},(_,i)=>`reason${i}`).join(' ')
const pid=(await db.query(`select save_proposal('Pilot','Summary',$1::jsonb,true,null) id`,[JSON.stringify({motivation})])).rows[0].id
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
// --- 202609100006 review integrity -----------------------------------------
// A second initiative led by ids.member, so each initiative can review the other.
await actor(ids.member)
const pid2=(await db.query(`select save_proposal('Companion','Second summary',$1::jsonb,true,null) id`,[JSON.stringify({motivation})])).rows[0].id
await actor(ids.admin)
const iid2=(await db.query(`select decide_proposal($1,'approved','ready') id`,[pid2])).rows[0].id
await db.exec('reset role')
await db.query(`update initiatives set activated_at='2020-01-01' where id=$1`,[iid2])
await actor(ids.admin)
await db.query(`select open_cycle('2026-03-09',false)`)
const rm2=(await db.query(`select id from obligations where initiative_id=$1 and kind='rm'`,[iid2])).rows[0].id
const review2=(await db.query(`select id from obligations where initiative_id=$1 and kind='review'`,[iid2])).rows[0].id
await actor(ids.member)
const did2=(await db.query('select submit_obligation($1,$2,null,null) id',[rm2,content])).rows[0].id
async function overdue(id){await db.exec('reset role');await db.query(`update obligations set due_at=now()-interval '1 day' where id=$1`,[id]);await actor(ids.admin)}
const hp=async id=>(await db.query('select hp_balance($1) hp',[id])).rows[0].hp
const count=async(sql,params=[])=>(await db.query(sql,params)).rows[0].c
// A lapse after a reversed penalty is charged again; retries never charge twice.
await actor(ids.admin)
await db.query(`select assign_review_target($1,$2,now()+interval '7 days')`,[review2,did])
// --- 202609100007 storage privacy ----------------------------------------
// initiative-images reads: owning-initiative participants and reviewers holding a
// live review of that initiative; unrelated approved and non-approved are denied.
await db.exec('reset role')
await db.query(`insert into storage.objects(bucket_id,name) values('initiative-images',$1)`,[iid+'/cover.png'])
const imagesSeen=async()=>(await db.query(`select * from storage.objects where bucket_id='initiative-images'`)).rows.length
await actor(ids.lead)
assert.equal(await imagesSeen(),1)
await actor(ids.member)
assert.equal(await imagesSeen(),1)
await actor(ids.pending)
assert.equal(await imagesSeen(),0)
await actor(ids.admin)
await db.query(`select decide_account($1,'suspended','storage privacy test')`,[ids.pending])
await actor(ids.pending)
assert.equal(await imagesSeen(),0)
await actor(ids.admin)
await db.query(`select decide_account($1,'approved','storage privacy test')`,[ids.pending])
await overdue(review2)
await db.query('select evaluate_due_obligations()')
await db.query('select evaluate_due_obligations()')
assert.equal(await hp(iid2),90)
await db.query(`select assign_review_target($1,$2,now()+interval '7 days')`,[review2,did])
assert.equal(await hp(iid2),100)
await overdue(review2)
await db.query('select evaluate_due_obligations()')
await db.query('select evaluate_due_obligations()')
assert.equal(await hp(iid2),90)
assert.equal(await count(`select count(*)::int c from hp_events where kind='penalty' and obligation_id=$1`,[review2]),2)
// A reviewer who joins the reviewed initiative can no longer submit that review.
await db.query(`select assign_review_target($1,$2,now()+interval '7 days')`,[review.id,did2])
await actor(ids.lead)
const jr=(await db.query(`select request_join($1,'Interested in the companion work') id`,[iid2])).rows[0].id
await actor(ids.member)
await db.query(`select decide_join_request($1,true,'welcome')`,[jr])
await actor(ids.lead)
await rejected('select submit_obligation($1,$2,$3,1)',[review.id,content,did2])
// Transfer moves unfinished work, releases a review the new lead cannot judge back to
// Research, and reverses that obligation's live penalty.
await overdue(review.id)
await db.query('select evaluate_due_obligations()')
assert.equal(await hp(iid),90)
await actor(ids.member)
const jr2=(await db.query(`select request_join($1,'Happy to help') id`,[iid])).rows[0].id
await actor(ids.lead)
await db.query(`select decide_join_request($1,true,'welcome')`,[jr2])
await db.query('select transfer_lead($1,$2)',[iid,ids.member])
const released=(await db.query('select * from obligations where id=$1',[review.id])).rows[0]
assert.equal(released.responsible_user_id,ids.member)
assert.equal(released.target_document_id,null)
assert.equal(released.status,'open')
assert.equal(await hp(iid),100)
await db.exec('reset role')
const notes=(await db.query(`select user_id from notifications where kind='review_unassigned'`)).rows
assert.equal(notes.length,1)
assert.equal(notes[0].user_id,ids.admin)
// The current lead revises a submitted memo: new version, same author and v1, no new HP.
const revised={html:'<p>Revised progress</p>',blocks:[]}
await actor(ids.member)
await db.query('select save_document_draft($1,$2,null)',[rm.id,revised])
await db.query('select submit_obligation($1,$2,null,null)',[rm.id,revised])
const versions=(await db.query('select version_number,content from document_versions where document_id=$1 order by version_number',[did])).rows
assert.equal(versions.length,2)
assert.deepEqual(versions[0].content,content)
assert.equal((await db.query('select author_id from documents where id=$1',[did])).rows[0].author_id,ids.lead)
assert.equal(await count(`select count(*)::int c from hp_events where kind='reward' and obligation_id=$1`,[rm.id]),1)
assert.equal(await hp(iid),100)
// The memo follows the role: the former lead, still the recorded assignee, is refused.
await actor(ids.lead)
await rejected('select submit_obligation($1,$2,null,null)',[rm.id,{html:'<p>Former lead</p>',blocks:[]}])
// Leadership is not a general submit override: a non-lead outsider is still refused.
await actor(ids.pending)
await rejected('select submit_obligation($1,$2,null,null)',[rm.id,revised])
// Invariant replacing the dropped unique index: at most one live penalty per obligation.
await db.exec('reset role')
assert.equal(await count(`select count(*)::int c from (select obligation_id from hp_events e where e.kind='penalty' and not exists(select 1 from hp_events r where r.reversed_event_id=e.id) group by obligation_id having count(*)>1) x`),0)
await actor(ids.admin)
await db.query(`select decide_account($1,'suspended','access test')`,[ids.member])
await actor(ids.member)
assert.equal((await db.query('select * from documents')).rows.length,0)
await rejected(`select add_comment($1,1,'block-1','Forbidden',null,null,'Progress')`,[did])
await db.close()
console.log('PASS: approval gate, private drafts, submitted visibility, deadlines, idempotency, late HP, suspension,')
console.log('      submit-time review conflict, lead transfer release + revision history, penalty recurrence, image read scoping.')
