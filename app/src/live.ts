import { initiativeAbstract } from './initiative-details'
import { supabase } from './client'
import { cleanImportedText, importedDocumentTitle } from './imported-title'
import type { Data, DocumentRecord, ProfileDetails } from './model'
import { imageExtension, imageFileError, normalizeProfileDetails, profileDetailsError } from './model'
const empty=():Data=>({people:[],initiatives:[],documents:[],obligations:[],threads:[],requests:[],audit:[],notifications:[]})
const SIGNUP_KEY='openlabs:signup:pending:v1'
/**
 * Signup details normally travel in the magic-link metadata and are written by
 * the handle_new_user trigger. They are also kept here until a profile row
 * proves they arrived, so a link that is confirmed later - or an account that
 * already existed before the details were entered - can still be completed by
 * update_my_profile. The copy is removed the first time it is examined.
 */
export function rememberSignup(email:string,details:ProfileDetails){try{localStorage.setItem(SIGNUP_KEY,JSON.stringify({email:email.trim().toLowerCase(),...details}))}catch{/* storage disabled: rely on the auth metadata */}}
function takePendingSignup():(ProfileDetails&{email:string})|null{try{const raw=localStorage.getItem(SIGNUP_KEY);localStorage.removeItem(SIGNUP_KEY);return raw?JSON.parse(raw) as ProfileDetails&{email:string}:null}catch{return null}}
async function applyPendingSignup():Promise<boolean>{
 const pending=takePendingSignup()
 if(!pending)return false
 const details=normalizeProfileDetails(pending)
 if(profileDetailsError(details))return false
 // Only ever completes the account those details were typed for.
 const {data}=await supabase!.auth.getUser()
 const email=data.user?.email?.toLowerCase()??''
 if(pending.email&&email&&pending.email!==email)return false
 await rpc('update_my_profile',{p_display_name:details.name,p_major:details.major,p_interests:details.interests})
 return true
}
export async function rpc(name:string,args:Record<string,unknown>={}){
 if(!supabase)throw new Error('Supabase is not configured')
 const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message);return data
}
async function rows(table:string){const {data,error}=await supabase!.from(table).select('*');if(error)throw new Error(`${table}: ${error.message}`);return data??[]}
const html=(content:any)=>typeof content?.html==='string'?content.html:'<p>Imported content is available in the source record.</p>'
const title=(content:any,fallback:string)=>content?.title||fallback
/**
 * Inline images.
 *
 * The durable reference to an uploaded image is its storage object path, held
 * in `data-object-path` and written into document content. A `src` is only ever
 * a signed URL minted for one render and it expires, so it is stripped from
 * everything on its way into the database and re-derived on the way out. That
 * is what keeps an OLD version's images resolvable: the version rows keep the
 * path, and each load signs it again for whoever is currently allowed to read
 * it.
 */
const IMAGES_BUCKET = 'initiative-images'
const COVERS_BUCKET = 'initiative-covers'
const SIGNED_URL_TTL = 3600

// The three rewriters below are exported only so src/image-refs.test.ts can
// regression-test the real implementation rather than a copy of it. They are
// pure apart from needing a DOM, and nothing outside this module calls them.
const parseBody = (htmlStr: string) => new DOMParser().parseFromString(htmlStr, 'text/html')
/** Object paths a stored body refers to. */
export const objectPathsIn = (htmlStr: string): string[] => {
  if (!htmlStr.includes('data-object-path')) return []
  return Array.from(parseBody(htmlStr).querySelectorAll('img[data-object-path]'))
    .map(img => img.getAttribute('data-object-path') || '').filter(Boolean)
}
/**
 * One batched signing round trip per bucket per load, instead of one per image
 * per version. A path the caller may not read yields no URL. The viewer offers
 * a retry without exposing a link or dropping the original reference.
 */
async function signPaths(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  const unique = [...new Set(paths)].filter(Boolean)
  if (!unique.length) return urls
  const { data, error } = await supabase!.storage.from(bucket).createSignedUrls(unique, SIGNED_URL_TTL)
  if (error) console.warn('Image URLs could not be refreshed; retry is available in the document viewer.')
  for (const entry of data ?? []) {
    const path = (entry as { path?: string | null }).path
    if (path && entry.signedUrl && !entry.error) urls.set(path, entry.signedUrl)
  }
  return urls
}
export async function retryDocumentImage(path: string, bucket: 'initiative-images' | 'initiative-content-images' = 'initiative-images'): Promise<string> {
  const urls = await signPaths(bucket, [path])
  const url = urls.get(path)
  if (!url) throw new Error('Image unavailable')
  return url
}
/** Attach freshly signed URLs to one stored body for this render only. */
export const applyImageUrls = (htmlStr: string, urls: Map<string, string>) => {
  if (!htmlStr.includes('data-object-path')) return htmlStr
  const doc = parseBody(htmlStr)
  doc.querySelectorAll('img[data-object-path]').forEach(img => {
    const path = img.getAttribute('data-object-path')
    img.setAttribute('src', (path && urls.get(path)) || '')
  })
  return doc.body.innerHTML
}
/**
 * Canonical content never carries a signed URL. Every write path runs through
 * this, so an expiring link can never end up as the persisted reference.
 */
export const stripSignedUrls = (htmlStr: string) => {
  if (!htmlStr.includes('data-object-path')) return htmlStr
  const doc = parseBody(htmlStr)
  doc.querySelectorAll('img[data-object-path]').forEach(img => { img.setAttribute('src', '') })
  return doc.body.innerHTML
}
export async function loadLive(userId:string|null):Promise<Data>{
 const state=empty()
 if(!userId){state.initiatives=(await rows('initiative_catalog')).map(i=>({id:i.id,title:i.title,abstract:cleanImportedText(i.summary),status:i.status,category:'Research',leadId:'',leadName:i.lead_name??'',members:[],tasks:[],hp:100}));return state}
 const profiles=await rows('profiles')
 const mine=profiles.find(p=>p.id===userId)
 // A profile with no name yet: finish the signup once, then read the row back.
 if(mine&&!String(mine.display_name??'').trim()&&await applyPendingSignup())return loadLive(userId)
 // The raw display_name travels as-is, empty included: the UI shows its own
 // placeholder for a profile that has not been filled in yet.
 state.people=profiles.map(p=>({id:p.id,name:p.display_name??'',email:'',status:p.account_status,roles:[],major:p.major??'',interests:p.interests??''}))
 if(state.people.find(p=>p.id===userId)?.status!=='approved'){
 state.initiatives=(await rows('initiative_catalog')).map(i=>({id:i.id,title:i.title,abstract:cleanImportedText(i.summary),status:i.status,category:'Research',leadId:'',leadName:i.lead_name??'',members:[],tasks:[],hp:100}));return state
 }
 const [roles,initiatives,memberships,tasks,obligations,docs,versions,drafts,threads,comments,proposals,joins,audit,notifs,cycles]=await Promise.all(['role_grants','initiatives','initiative_memberships','tasks','obligations','documents','document_versions','document_drafts','comment_threads','comments','proposals','join_requests','audit_events','notifications','cycles'].map(rows))
 // Which weeks Research has actually opened. A Roast Me draft can name a week
 // that is not in here yet; that is a pending week, not an error.
 state.cycles=cycles.map(c=>({startsOn:String(c.starts_on).slice(0,10),isBreak:!!c.is_break,rmDue:c.rm_due_at,reviewDue:c.review_due_at})).sort((a,b)=>a.startsOn.localeCompare(b.startsOn))
 state.people.forEach(p=>p.roles=roles.filter(r=>r.user_id===p.id&&!r.revoked_at).map(r=>r.role))
 if(state.people.find(p=>p.id===userId)?.roles.some(r=>r==='operations'||r==='research'||r==='admin')){
 const emails=await rpc('admin_account_emails') as {user_id:string;email:string|null}[]
 const byId=new Map(emails.map(e=>[e.user_id,e.email??'']))
 state.people.forEach(p=>p.email=byId.get(p.id)??'')
 }
 // One signing round trip for the whole page: every object path referenced by a
 // document body, any stored version, or a task description. Old versions keep
 // their images because their own paths are signed here too.
 const shaped=docs.map(d=>{const vs=versions.filter(v=>v.document_id===d.id).sort((a,b)=>a.version_number-b.version_number);const draft=drafts.find(v=>v.document_id===d.id);const content=draft?.content??vs.at(-1)?.content??{};return {d,vs,draft,content,bodyHtml:html(content),versionHtml:vs.map(v=>html(v.content))}})
 const imageUrls=await signPaths(IMAGES_BUCKET,[
  ...shaped.flatMap(s=>[...objectPathsIn(s.bodyHtml),...s.versionHtml.flatMap(objectPathsIn)]),
  ...tasks.flatMap(t=>objectPathsIn(String(t.details??''))),
 ])
 const coverUrls=await signPaths(COVERS_BUCKET,initiatives.map(i=>i.cover_object_path).filter(Boolean))
 const initiativeUrls=await signPaths('initiative-content-images',initiatives.flatMap(i=>[...objectPathsIn(i.content?.abstract_html??''),...objectPathsIn(i.content?.motivation_html??'')]))
 state.initiatives=await Promise.all(initiatives.map(async i=>({id:i.id,title:i.title,abstract:initiativeAbstract(i.summary,i.content?.html),status:i.status,category:i.content?.category||'Research',leadId:i.lead_id??'',leadName:i.lead_name??'',members:memberships.filter(m=>m.initiative_id===i.id&&!m.left_at).map(m=>m.user_id),tasks:tasks.filter(t=>t.initiative_id===i.id).map(t=>({id:t.id,title:t.title,description:applyImageUrls(String(t.details??''),imageUrls),status:t.status,assigneeId:t.assignee_id??undefined,dueAt:t.due_at??undefined})),hp:await rpc('hp_balance',{i:i.id}),motivation:cleanImportedText(i.content?.motivation??''),overviewHtml:i.content?.html??'',abstractHtml:applyImageUrls(i.content?.abstract_html??'',initiativeUrls),motivationHtml:applyImageUrls(i.content?.motivation_html??'',initiativeUrls),coverObjectPath:i.cover_object_path??undefined,coverFallbackColor:i.cover_fallback_color??undefined,coverPositionX:i.cover_position_x??50,coverPositionY:i.cover_position_y??50,coverUrl:i.cover_object_path?coverUrls.get(i.cover_object_path):undefined})))
 state.obligations=obligations.map(o=>({id:o.id,initiativeId:o.initiative_id,assigneeId:o.responsible_user_id,kind:o.kind,due:o.due_at,status:o.status==='open'?'pending':o.status==='submitted'?'complete':o.status,targetId:o.target_document_id,targetVersion:o.target_version}))
 state.documents=shaped.map(({d,vs,draft,content,bodyHtml,versionHtml})=>{const latest=vs.at(-1);const historical=d.is_historical_import===true||content?.historical===true;const sourceOrder=Number(content?.source_order);return {id:d.id,initiativeId:d.initiative_id,kind:d.kind,title:historical?importedDocumentTitle(title(content,d.kind==='rm'?'Roast Me':'Peer review'),d.kind,d.kind==='review'?shaped.filter(x=>x.d.id===d.reviewed_document_id).map(x=>importedDocumentTitle(title(x.content,'Roast Me'),'rm'))[0]:undefined):title(content,d.kind==='rm'?'Roast Me':'Peer review'),authorId:d.author_id??'',authorName:typeof content?.source_author==='string'?content.source_author:undefined,status:draft?'draft':d.submitted_version_number?'submitted':'draft',body:applyImageUrls(bodyHtml,imageUrls),version:d.submitted_version_number??0,submittedAt:historical?undefined:obligations.find(o=>o.id===d.obligation_id)?.submitted_at??latest?.submitted_at,targetId:d.reviewed_document_id,historical,sourceKey:typeof content?.source_key==='string'?content.source_key:typeof d.historical_source_key==='string'?d.historical_source_key:undefined,sourceDate:typeof content?.source_date==='string'?content.source_date:typeof content?.source_date_text==='string'?content.source_date_text:undefined,sourcePeriod:typeof content?.source_period==='string'?(historical?cleanImportedText(content.source_period):content.source_period):undefined,sourcePeriodKey:typeof content?.source_period_key==='string'?content.source_period_key:undefined,sourceWeek:typeof content?.source_week==='string'?(historical?cleanImportedText(content.source_week):content.source_week):undefined,sourceOrder:Number.isInteger(sourceOrder)&&sourceOrder>0?sourceOrder:undefined,targetMonday:d.target_monday?String(d.target_monday).slice(0,10):undefined,obligationId:d.obligation_id??undefined,draftRevision:draft?.revision,versions:vs.map((v,idx)=>({version:v.version_number,body:applyImageUrls(versionHtml[idx],imageUrls),at:v.submitted_at}))} as DocumentRecord})
 state.threads=threads.map(t=>({id:t.id,documentId:t.document_id,version:t.version_number,quote:t.quote||'',resolved:!!t.resolved_at,anchorStart:t.anchor_start??undefined,anchorEnd:t.anchor_end??undefined,messages:comments.filter(c=>c.thread_id===t.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(c=>({authorId:c.author_id,body:c.body,at:c.created_at}))}))
 state.requests=[...proposals.map(p=>({id:p.id,kind:'proposal' as const,userId:p.author_id,title:p.title,body:JSON.stringify({abstract:p.summary,category:p.content?.category,plan:p.content?.html,motivation:p.content?.motivation}),status:p.status,feedback:p.decision_reason})),...joins.map(j=>({id:j.id,kind:'join' as const,userId:j.applicant_id,initiativeId:j.initiative_id,title:'Join request',body:j.message,status:j.status,feedback:j.decision_reason}))]
 state.audit=audit.map(a=>({id:a.id,at:a.created_at,actor:a.actor_id,action:a.action,detail:JSON.stringify(a.detail)}));
 state.notifications=notifs.map(n=>({id:n.id,userId:n.user_id,kind:n.kind,payload:n.payload||{},createdAt:n.created_at,readAt:n.read_at}));
 return state
}
/**
 * Upload one image and return its object path. The key is
 * `{initiative}/{uuid}.{ext}` where the extension comes from the already
 * validated MIME type - the supplied file name never reaches the storage key,
 * so it cannot introduce a path separator, a `..` segment or URL punctuation.
 */
async function uploadImage(bucket:string,initiativeId:string,file:File):Promise<string>{
 const problem=imageFileError(file)
 if(problem)throw new Error(problem)
 if(!initiativeId)throw new Error('An initiative is required before uploading.')
 const path=`${initiativeId}/${crypto.randomUUID()}.${imageExtension(file.type)}`
 const {error}=await supabase!.storage.from(bucket).upload(path,file,{contentType:file.type,upsert:false})
 if(error)throw new Error(`Upload failed: ${error.message}`)
 return path
}
/**
 * Register a freshly uploaded object, and remove it again if registration
 * fails. `isOurs` is re-checked first: a failure response can still follow a
 * committed write, and another editor may have replaced the reference in the
 * meantime, so the object is only deleted when the database confirms nothing
 * points at it.
 */
async function registerOrRollBack<T>(bucket:string,path:string,register:()=>Promise<T>,isOurs:()=>Promise<boolean>):Promise<T>{
 try{
  return await register()
 }catch(e){
  let orphaned=true
  try{orphaned=!await isOurs()}catch{/* cannot confirm: keep the bytes */orphaned=false}
  if(orphaned)await supabase!.storage.from(bucket).remove([path]).catch(()=>{})
  throw e
 }
}
export async function liveAction(data:Data,_userId:string|null,action:string,p:any){
 const id=p.id??p.documentId??p.requestId??p.userId??p.initiativeId
 const doc:DocumentRecord|undefined=data.documents.find(d=>d.id===(p.documentId??p.id))
 const obligation=data.obligations.find(o=>o.id===(p.obligationId??doc?.obligationId))
 // Built once, already stripped: no write path can accidentally persist the
 // signed URL that the editor was displaying.
 const content={html:stripSignedUrls(p.body??doc?.body??'<p></p>'),title:p.title??doc?.title??'Roast Me',blocks:[]}
 switch(action){
 case 'decideAccount':return rpc('decide_account',{p_user:p.userId??id,p_status:p.status,p_reason:p.reason||'Reviewed by administrator'})
 // Self-only by construction: update_my_profile takes no target user and writes
 // the auth.uid() row; account status, roles and the sign-in email are untouched.
 case 'updateProfile':{const d=normalizeProfileDetails(p);const problem=profileDetailsError(d);if(problem)throw new Error(problem);return rpc('update_my_profile',{p_display_name:d.name,p_major:d.major,p_interests:d.interests})}
 case 'createProposal':return rpc('save_proposal',{p_title:p.title,p_summary:p.body??p.abstract??'',p_content:{html:p.plan??'',category:p.category,motivation:p.motivation??''},p_submit:p.status!=='draft',p_id:p.id??null})
 case 'decideProposal':return rpc('decide_proposal',{p_proposal:p.requestId??id,p_status:p.status??p.decision,p_reason:p.feedback??p.reason??''})
 case 'requestJoin':return rpc('request_join',{p_initiative:p.initiativeId??id,p_message:p.body??p.message??''})
 case 'decideJoin':return rpc('decide_join_request',{p_request:p.requestId??id,p_approve:p.approve??(p.status??p.decision)==='approved',p_reason:p.feedback??p.reason??''})
 // A Roast Me draft belongs to the team, not to a cycle: save_rm_draft creates
 // or updates it with only the target week, and never needs an obligation. Peer
 // reviews stay on the obligation-scoped path, because a review only exists
 // once Research has assigned it.
 case 'reviseDocument':case 'createDraft':case 'saveDraft':{
 const kind=p.kind??doc?.kind??'rm'
 // A Roast Me that is already submitted keeps the pre-013 revise path: it has an
 // obligation, and save_document_draft reopens it against that obligation.
 const revising=kind==='rm'&&!!doc?.obligationId&&doc.status!=='draft'
 if(kind==='rm'&&!revising){
  const initiativeId=p.initiativeId??doc?.initiativeId
  if(!initiativeId)throw new Error('An initiative is required to start a Roast Me.')
  return rpc('save_rm_draft',{p_initiative:initiativeId,p_content:content,p_target_monday:p.targetMonday??doc?.targetMonday??null,p_document:p.documentId??doc?.id??null,p_revision:p.revision??doc?.draftRevision??null})
 }
 if(revising)return rpc('save_document_draft',{p_obligation:doc!.obligationId!,p_content:content,p_revision:p.revision??doc?.draftRevision??null})
 const oid=p.obligationId??doc?.obligationId??data.obligations.find(o=>o.initiativeId===p.initiativeId&&o.kind==='review'&&['pending','missed'].includes(o.status))?.id
 if(!oid)throw new Error('No assigned review to draft against yet.')
 return rpc('save_document_draft',{p_obligation:oid,p_content:content,p_revision:p.revision??doc?.draftRevision??null})}
 // Retargeting is its own command so the week can move without touching content.
 case 'setDraftTarget':return rpc('set_rm_draft_target',{p_document:p.documentId??id,p_target_monday:p.targetMonday})
 case 'submitDocument':{
 // submit_rm_draft resolves the target week to its cycle, attaches the one RM
 // obligation and then delegates to submit_obligation, so deadlines, HP and the
 // lead-only rule are unchanged. An already-attached draft skips straight there.
 if((doc?.kind??'rm')==='rm'){
  if(!doc)throw new Error('Draft not found.')
  return rpc('submit_rm_draft',{p_document:doc.id,p_content:content})
 }
 if(!obligation)throw new Error('No obligation for this document')
 return rpc('submit_obligation',{p_obligation:obligation.id,p_content:content,p_reviewed_document:obligation.targetId??null,p_reviewed_version:(obligation as any).targetVersion??null})}
 // An anchored thread carries the character range of the selected passage so the
 // highlight can be drawn over that version's text. Without a range it is an
 // ordinary quote-only thread and keeps the original RPC.
 case 'addThread':{
  if(Number.isInteger(p.anchorStart)&&Number.isInteger(p.anchorEnd)){
   return rpc('add_anchored_comment',{p_document:p.documentId,p_version:p.version??doc?.version,p_quote:p.quote??'',p_anchor_start:p.anchorStart,p_anchor_end:p.anchorEnd,p_body:p.body})
  }
  return rpc('add_comment',{p_document:p.documentId,p_version:p.version??doc?.version,p_block_id:p.blockId??'document',p_body:p.body,p_quote:p.quote??'',p_thread:null,p_parent:null})}
 case 'replyThread':{const t=data.threads.find(t=>t.id===(p.threadId??id));if(!t)throw new Error('Thread not found');return rpc('add_comment',{p_document:t.documentId,p_version:t.version,p_block_id:'document',p_body:p.body,p_thread:t.id,p_parent:null,p_quote:null})}
 case 'resolveThread':return rpc('resolve_comment_thread',{p_thread:p.threadId??id,p_resolved:p.resolved??true})
 case 'setTaskStatus':return rpc('update_task_status',{p_task:p.taskId??id,p_status:p.status})
 // A description may hold inline images. Its durable form keeps data-object-path
 // and drops the signed src, exactly as document content does.
 case 'updateTask':return rpc('update_task',{p_task:p.taskId??id,p_title:p.title,p_details:stripSignedUrls(p.description??''),p_assignee:p.assigneeId??null,p_due_at:p.dueAt??null,p_status:p.status})
 case 'addTask':return rpc('create_task',{p_initiative:p.initiativeId,p_title:p.title,p_details:stripSignedUrls(p.description??''),p_assignee:p.assigneeId??null,p_due_at:p.dueAt??null,p_status:p.status??'planned'})
 case 'deleteTask':return rpc('delete_task',{p_task:p.taskId??id})
 case 'assignReview':{const candidates=data.obligations.filter(o=>o.kind==='review'&&o.assigneeId===p.reviewerId&&['pending','missed'].includes(o.status));const oid=p.obligationId??(candidates.length===1?candidates[0].id:null);if(!oid)throw new Error('Select an accountable initiative obligation. Open the cycle first if no obligations exist.');return rpc('assign_review_target',{p_obligation:oid,p_target:p.targetId??p.documentId,p_due_at:p.due??null})}
 case 'setStatus':return rpc('set_initiative_status',{p_initiative:p.initiativeId??id,p_status:p.status,p_reason:p.reason||'Leadership decision'})
 case 'adjustHp':return rpc('adjust_hp',{p_initiative:p.initiativeId??id,p_points:Number(p.points??p.delta),p_reason:p.reason})
 case 'setRole':return rpc('change_role',{p_user:p.userId??id,p_role:p.role,p_enabled:p.enabled??p.grant??true})
 case 'transferLead':return rpc('transfer_lead',{p_initiative:p.initiativeId,p_user:p.userId})
 case 'updateInitiativeContent':return rpc('update_initiative_content',{p_initiative:p.initiativeId,p_title:p.title,p_category:p.category,p_abstract_html:stripSignedUrls(p.abstractHtml??''),p_motivation_html:stripSignedUrls(p.motivationHtml??'')})
 case 'updateInitiativeDetails':return rpc('update_initiative_details',{p_initiative:p.initiativeId,p_title:p.title,p_summary:p.abstract,p_category:p.category,p_motivation:p.motivation,p_html:stripSignedUrls(p.overviewHtml??'')})
 case 'leaveInitiative':return rpc('leave_initiative',{p_initiative:p.initiativeId,p_user:p.userId??_userId})
 case 'setPolicy':return rpc('set_policy',{p_penalty:p.penalty,p_reward:p.reward})
 case 'openCycle':return rpc('open_cycle',{p_monday:p.monday,p_break:p.isBreak??false})
 case 'evaluateDeadlines':return rpc('evaluate_due_obligations')
 case 'readNotification':return rpc('read_notification',{p_id:p.id})
 // expectedVersion is the snapshot the form was opened with, never a value
 // re-read after a background refresh; revise_rm rejects a stale one.
 case 'reviseRm': return rpc('revise_rm',{p_document:p.documentId,p_content:content,p_reason:p.reason,p_author:p.authorId||null,p_source_author:p.sourceAuthor||null,p_expected_version:p.expectedVersion})
 case 'uploadCover':{
   const f=p.file as File
   const path=await uploadImage(COVERS_BUCKET,p.initiativeId,f)
   return registerOrRollBack(COVERS_BUCKET,path,
     ()=>rpc('set_initiative_cover',{p_initiative:p.initiativeId,p_object_path:path,p_mime:f.type,p_bytes:f.size}),
     // Only clean up an object nothing points at. A failure response can still
     // follow a committed write, and another lead may have set a different
     // cover meanwhile - in both cases the stored path is not ours to delete.
     async()=>{const {data}=await supabase!.from('initiatives').select('cover_object_path').eq('id',p.initiativeId).maybeSingle();return data?.cover_object_path===path})
 }
 case 'setCoverColor': return rpc('set_initiative_cover_color',{p_initiative:p.initiativeId,p_color:p.color||null})
 case 'setCoverPosition': return rpc('set_initiative_cover_position',{p_initiative:p.initiativeId,p_x:p.x,p_y:p.y})
 case 'clearCover': return rpc('clear_initiative_cover',{p_initiative:p.initiativeId})
 case 'uploadRmImage':{
   const f=p.file as File
   // The folder must be the document's own initiative; attach_rm_image checks
   // the same thing, so a mismatched caller hint rolls the upload back.
   const path=await uploadImage(IMAGES_BUCKET,doc?.initiativeId??p.initiativeId,f)
   await registerOrRollBack(IMAGES_BUCKET,path,
     ()=>rpc('attach_rm_image',{p_document:p.documentId,p_object_path:path,p_mime:f.type,p_bytes:f.size}),
     async()=>{const {data}=await supabase!.from('document_attachments').select('id').eq('object_path',path).maybeSingle();return !!data})
   const {data}=await supabase!.storage.from(IMAGES_BUCKET).createSignedUrl(path,SIGNED_URL_TTL)
   // The path is the durable reference; the URL is only for this editing session.
   p.result={path,url:data?.signedUrl||''}
   return
 }
 // Task description images use the same bucket, validation, durable object path
 // and rollback as Roast Me images; only the registering RPC differs, because the
 // read audience is a task's audience rather than a document's.
 case 'uploadInitiativeImage':{
   const path=await uploadImage('initiative-content-images',p.initiativeId,p.file as File)
   const {data,error}=await supabase!.storage.from('initiative-content-images').createSignedUrl(path,SIGNED_URL_TTL)
   if(error||!data?.signedUrl)throw new Error('Image uploaded but could not be displayed. Please retry.')
   p.result={path,url:data.signedUrl}
   return
 }
 case 'uploadTaskImage':{
   const f=p.file as File
   const path=await uploadImage(IMAGES_BUCKET,p.initiativeId,f)
   await registerOrRollBack(IMAGES_BUCKET,path,
     ()=>rpc('attach_task_image',{p_task:p.taskId,p_object_path:path,p_mime:f.type,p_bytes:f.size}),
     async()=>{const {data}=await supabase!.from('task_attachments').select('id').eq('object_path',path).maybeSingle();return !!data})
   const {data}=await supabase!.storage.from(IMAGES_BUCKET).createSignedUrl(path,SIGNED_URL_TTL)
   p.result={path,url:data?.signedUrl||''}
   return
 }
 case 'detachTaskImage':return rpc('detach_task_image',{p_attachment:p.attachmentId})
 default:throw new Error(`Unsupported action: ${action}`)
 }
}
