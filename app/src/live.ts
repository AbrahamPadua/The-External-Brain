import { supabase } from './client'
import type { Data, DocumentRecord } from './model'
const empty=():Data=>({people:[],initiatives:[],documents:[],obligations:[],threads:[],requests:[],audit:[],notifications:[]})
export async function rpc(name:string,args:Record<string,unknown>={}){
 if(!supabase)throw new Error('Supabase is not configured')
 const {data,error}=await supabase.rpc(name,args);if(error)throw new Error(error.message);return data
}
async function rows(table:string){const {data,error}=await supabase!.from(table).select('*');if(error)throw new Error(`${table}: ${error.message}`);return data??[]}
const html=(content:any)=>typeof content?.html==='string'?content.html:'<p>Imported content is available in the source record.</p>'
const title=(content:any,fallback:string)=>content?.title||fallback
export async function loadLive(userId:string|null):Promise<Data>{
 const state=empty()
 if(!userId){state.initiatives=(await rows('initiative_catalog')).map(i=>({id:i.id,title:i.title,abstract:i.summary,status:i.status,category:'Research',leadId:'',members:[],tasks:[],hp:100}));return state}
 const profiles=await rows('profiles')
 state.people=profiles.map(p=>({id:p.id,name:p.display_name||'Member',email:'',status:p.account_status,roles:[]}))
 if(state.people.find(p=>p.id===userId)?.status!=='approved'){
 state.initiatives=(await rows('initiative_catalog')).map(i=>({id:i.id,title:i.title,abstract:i.summary,status:i.status,category:'Research',leadId:'',members:[],tasks:[],hp:100}));return state
 }
 const [roles,initiatives,memberships,tasks,obligations,docs,versions,drafts,threads,comments,proposals,joins,audit,notifs]=await Promise.all(['role_grants','initiatives','initiative_memberships','tasks','obligations','documents','document_versions','document_drafts','comment_threads','comments','proposals','join_requests','audit_events','notifications'].map(rows))
 state.people.forEach(p=>p.roles=roles.filter(r=>r.user_id===p.id&&!r.revoked_at).map(r=>r.role))
 if(state.people.find(p=>p.id===userId)?.roles.some(r=>r==='operations'||r==='research')){
 const emails=await rpc('admin_account_emails') as {user_id:string;email:string|null}[]
 const byId=new Map(emails.map(e=>[e.user_id,e.email??'']))
 state.people.forEach(p=>p.email=byId.get(p.id)??'')
 }
 state.initiatives=await Promise.all(initiatives.map(async i=>({id:i.id,title:i.title,abstract:i.summary,status:i.status,category:i.content?.category||'Research',leadId:i.lead_id,members:memberships.filter(m=>m.initiative_id===i.id&&!m.left_at).map(m=>m.user_id),tasks:tasks.filter(t=>t.initiative_id===i.id).map(t=>({id:t.id,title:t.title,done:t.status==='done'})),hp:await rpc('hp_balance',{i:i.id})})))
 state.obligations=obligations.map(o=>({id:o.id,initiativeId:o.initiative_id,assigneeId:o.responsible_user_id,kind:o.kind,due:o.due_at,status:o.status==='open'?'pending':o.status==='submitted'?'complete':o.status,targetId:o.target_document_id,targetVersion:o.target_version}))
 state.documents=docs.map(d=>{const vs=versions.filter(v=>v.document_id===d.id).sort((a,b)=>a.version_number-b.version_number);const latest=vs.at(-1);const draft=drafts.find(v=>v.document_id===d.id);return {id:d.id,initiativeId:d.initiative_id,kind:d.kind,title:title(draft?.content??latest?.content,d.kind==='rm'?'Weekly RM':'Peer review'),authorId:d.author_id,status:draft?'draft':d.submitted_version_number?'submitted':'draft',body:html(draft?.content??latest?.content),version:d.submitted_version_number??0,submittedAt:obligations.find(o=>o.id===d.obligation_id)?.submitted_at,targetId:d.reviewed_document_id,obligationId:d.obligation_id,draftRevision:draft?.revision,versions:vs.map(v=>({version:v.version_number,body:html(v.content),at:v.submitted_at}))} as DocumentRecord})
 state.threads=threads.map(t=>({id:t.id,documentId:t.document_id,version:t.version_number,quote:t.quote||'',resolved:!!t.resolved_at,messages:comments.filter(c=>c.thread_id===t.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(c=>({authorId:c.author_id,body:c.body,at:c.created_at}))}))
 state.requests=[...proposals.map(p=>({id:p.id,kind:'proposal' as const,userId:p.author_id,title:p.title,body:JSON.stringify({abstract:p.summary,category:p.content?.category,plan:p.content?.html}),status:p.status,feedback:p.decision_reason})),...joins.map(j=>({id:j.id,kind:'join' as const,userId:j.applicant_id,initiativeId:j.initiative_id,title:'Join request',body:j.message,status:j.status,feedback:j.decision_reason}))]
 state.audit=audit.map(a=>({id:a.id,at:a.created_at,actor:a.actor_id,action:a.action,detail:JSON.stringify(a.detail)}));
 state.notifications=notifs.map(n=>({id:n.id,userId:n.user_id,kind:n.kind,payload:n.payload||{},createdAt:n.created_at,readAt:n.read_at}));
 return state
}
export async function liveAction(data:Data,_userId:string|null,action:string,p:any){
 const id=p.id??p.documentId??p.requestId??p.userId??p.initiativeId
 const doc=data.documents.find(d=>d.id===(p.documentId??p.id)) as (DocumentRecord & {obligationId:string;draftRevision?:number})|undefined
 const obligation=data.obligations.find(o=>o.id===(p.obligationId??doc?.obligationId))
 const content={html:p.body??doc?.body??'<p></p>',title:p.title??doc?.title??'Weekly update',blocks:[]}
 switch(action){
 case 'decideAccount':return rpc('decide_account',{p_user:p.userId??id,p_status:p.status,p_reason:p.reason||'Reviewed by administrator'})
 case 'createProposal':return rpc('save_proposal',{p_title:p.title,p_summary:p.body??p.abstract??'',p_content:{html:p.plan??'',category:p.category},p_submit:p.status!=='draft',p_id:p.id??null})
 case 'decideProposal':return rpc('decide_proposal',{p_proposal:p.requestId??id,p_status:p.status??p.decision,p_reason:p.feedback??p.reason??''})
 case 'requestJoin':return rpc('request_join',{p_initiative:p.initiativeId??id,p_message:p.body??p.message??''})
 case 'decideJoin':return rpc('decide_join_request',{p_request:p.requestId??id,p_approve:p.approve??(p.status??p.decision)==='approved',p_reason:p.feedback??p.reason??''})
 case 'reviseDocument':case 'createDraft':case 'saveDraft':{
 const oid=p.obligationId??doc?.obligationId??data.obligations.find(o=>o.initiativeId===p.initiativeId&&o.kind===(p.kind??'rm')&&['pending','missed'].includes(o.status))?.id
 if(!oid)throw new Error('No open obligation. Research leadership must open a cycle first.')
 return rpc('save_document_draft',{p_obligation:oid,p_content:content,p_revision:p.revision??doc?.draftRevision??null})}
 case 'submitDocument':if(!obligation)throw new Error('No obligation for this document');return rpc('submit_obligation',{p_obligation:obligation.id,p_content:content,p_reviewed_document:obligation.targetId??null,p_reviewed_version:(obligation as any).targetVersion??null})
 case 'addThread':return rpc('add_comment',{p_document:p.documentId,p_version:p.version??doc?.version,p_block_id:p.blockId??'document',p_body:p.body,p_quote:p.quote??'',p_thread:null,p_parent:null})
 case 'replyThread':{const t=data.threads.find(t=>t.id===(p.threadId??id));if(!t)throw new Error('Thread not found');return rpc('add_comment',{p_document:t.documentId,p_version:t.version,p_block_id:'document',p_body:p.body,p_thread:t.id,p_parent:null,p_quote:null})}
 case 'resolveThread':return rpc('resolve_comment_thread',{p_thread:p.threadId??id,p_resolved:p.resolved??true})
 case 'toggleTask':{const task=data.initiatives.flatMap(i=>i.tasks).find(t=>t.id===(p.taskId??id));return rpc('update_task_status',{p_task:p.taskId??id,p_status:task?.done?'open':'done'})}
 case 'addTask':return rpc('create_task',{p_initiative:p.initiativeId,p_title:p.title})
 case 'assignReview':{const candidates=data.obligations.filter(o=>o.kind==='review'&&o.assigneeId===p.reviewerId&&['pending','missed'].includes(o.status));const oid=p.obligationId??(candidates.length===1?candidates[0].id:null);if(!oid)throw new Error('Select an accountable initiative obligation. Open the cycle first if no obligations exist.');return rpc('assign_review_target',{p_obligation:oid,p_target:p.targetId??p.documentId,p_due_at:p.due??null})}
 case 'setStatus':return rpc('set_initiative_status',{p_initiative:p.initiativeId??id,p_status:p.status,p_reason:p.reason||'Leadership decision'})
 case 'adjustHp':return rpc('adjust_hp',{p_initiative:p.initiativeId??id,p_points:Number(p.points??p.delta),p_reason:p.reason})
 case 'setRole':return rpc('change_role',{p_user:p.userId??id,p_role:p.role,p_enabled:p.enabled??p.grant??true})
 case 'transferLead':return rpc('transfer_lead',{p_initiative:p.initiativeId,p_user:p.userId})
 case 'leaveInitiative':return rpc('leave_initiative',{p_initiative:p.initiativeId,p_user:p.userId??_userId})
 case 'setPolicy':return rpc('set_policy',{p_penalty:p.penalty,p_reward:p.reward})
 case 'openCycle':return rpc('open_cycle',{p_monday:p.monday,p_break:p.isBreak??false})
 case 'evaluateDeadlines':return rpc('evaluate_due_obligations')
 case 'readNotification':return rpc('read_notification',{p_id:p.id})
 default:throw new Error(`Unsupported action: ${action}`)
 }
}
