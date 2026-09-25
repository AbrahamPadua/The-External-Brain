export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended'
export type Person = { id: string; name: string; email: string; status: AccountStatus; roles: string[]; major?: string; interests?: string }
export type TaskStatus = 'planned' | 'pending' | 'finished'
/**
 * Task description bound, matching tasks_details_length in migration 017. It is
 * sized for markup with inline image references rather than a bare sentence.
 */
export const TASK_DETAILS_MAX = 8000
export type InitiativeTask = { id:string; title:string; description:string; status:TaskStatus; assigneeId?:string; dueAt?:string }
export type Initiative = { id: string; title: string; abstract: string; leadId: string; leadName?: string; members: string[]; status: string; category: string; hp: number; tasks: InitiativeTask[]; motivation?: string; overviewHtml?: string; coverObjectPath?: string; coverFallbackColor?: string; coverUrl?: string; coverPositionX?: number; coverPositionY?: number }
/**
 * A document is a Roast Me ('rm' - constructive criticism of a team's work) or a
 * peer review. `targetMonday` is the Monday of the Los Angeles week an unsubmitted
 * Roast Me draft is meant for; it exists before any cycle does, and `obligationId`
 * stays empty until the draft is submitted into that week's cycle.
 */
export type DocumentRecord = { id:string; initiativeId:string; kind:'rm'|'review'; title:string; authorId:string; authorName?:string; status:string; body:string; version:number; submittedAt?:string; targetId?:string; targetMonday?:string; obligationId?:string; draftRevision?:number; historical?:boolean; sourceKey?:string; sourceDate?:string; sourcePeriod?:string; sourcePeriodKey?:string; sourceWeek?:string; sourceOrder?:number; versions:{version:number;body:string;at:string}[] }
/** An opened working week. `startsOn` is the Monday, matching cycles.starts_on. */
export type Cycle = { startsOn:string; isBreak:boolean; rmDue?:string; reviewDue?:string }
/** `targetVersion` pins a review obligation to the exact Roast Me version assigned. */
export type Obligation = { id:string; initiativeId:string; assigneeId:string; kind:'rm'|'review'; due:string; status:string; targetId?:string; targetVersion?:number }
/**
 * A comment thread. `version` is the submitted version it is anchored to, so a
 * thread never follows the document onto a later revision. `anchorStart`/
 * `anchorEnd` are character offsets into that version's plain text when the
 * thread came from a text selection; older quote-only threads leave them unset
 * and simply render beside the document.
 */
export type Thread = { id:string;documentId:string;version:number;quote:string;resolved:boolean;anchorStart?:number;anchorEnd?:number;messages:{authorId:string;body:string;at:string}[] }
export type Request = { id:string;kind:'proposal'|'join';userId:string;initiativeId?:string;title:string;body:string;status:string;feedback?:string }
export type Audit = { id:string;at:string;actor:string;action:string;detail:string }
export type Notification = { id:string;userId:string;kind:string;payload:any;createdAt:string;readAt?:string }
export type Data = { people:Person[]; initiatives:Initiative[]; documents:DocumentRecord[]; obligations:Obligation[]; threads:Thread[]; requests:Request[]; audit:Audit[]; notifications?:Notification[]; cycles?:Cycle[] }
export const uid=()=>crypto.randomUUID()
export const seed:Data={
 people:[{id:'maya',name:'Maya Chen',email:'maya@example.test',status:'approved',roles:['research'],major:'Cognitive Science',interests:'Spatial audio, assistive technology, psychophysics'},{id:'alex',name:'Alex Rivera',email:'alex@example.test',status:'approved',roles:[],major:'Neuroscience',interests:'Movement and memory, literature synthesis'},{id:'jordan',name:'Jordan Park',email:'jordan@example.test',status:'pending',roles:[],major:'Bioengineering',interests:''},{id:'sam',name:'Sam Patel',email:'sam@example.test',status:'approved',roles:['operations'],major:'Data Science',interests:'Research operations, reproducibility'}],
 initiatives:[{id:'sound',title:'Spatial Sound Lab',abstract:'Exploring how spatial audio can make everyday environments easier to navigate. Our team is building and evaluating a small prototype in a virtual environment.',leadId:'maya',members:['maya','alex'],status:'active',category:'Neuroengineering',hp:100,tasks:[{id:'t1',title:'Document the first prototype',description:'Capture setup and findings.',status:'finished',assigneeId:'maya'},{id:'t2',title:'Prepare the next pilot session',description:'',status:'pending',assigneeId:'alex'}]},{id:'memory',title:'Memory in Motion',abstract:'A collaborative literature review of the relationship between movement, learning, and memory. We are translating the evidence into a reproducible research question.',leadId:'alex',members:['alex'],status:'active',category:'Cognitive science',hp:100,tasks:[{id:'t3',title:'Complete the evidence matrix',description:'',status:'planned'}]}],
 documents:[{id:'rm-sound',initiativeId:'sound',kind:'rm',title:'A first working prototype',authorId:'maya',status:'submitted',body:'<h2>Progress</h2><p>We completed the first prototype and documented the mapping between distance and sound.</p><h2>Obstacles & support</h2><p>We need feedback on how to keep the experiment focused.</p><h2>Next steps</h2><p>Test one dimension at a time and record the results.</p>',version:1,submittedAt:'2026-09-04T20:00:00Z',versions:[]},{id:'rm-memory',initiativeId:'memory',kind:'rm',title:'Finding our research question',authorId:'alex',status:'submitted',body:'<h2>Progress</h2><p>Our literature matrix now includes twelve studies. We have identified three possible research directions.</p><h2>Obstacles & support</h2><p>Which question is feasible for a student team this term?</p><h2>Next steps</h2><p>Narrow the scope and document our inclusion criteria.</p>',version:1,submittedAt:'2026-09-04T21:00:00Z',versions:[]},
 // An imported historical memo. Its version 1 is the source record: Research
 // may revise it, but v1 and the account-less attribution are retained exactly
 // as the canonical import wrote them (see revise_rm in migration 012).
 {id:'rm-legacy',initiativeId:'memory',kind:'rm',title:'Week 3 - archived report',authorId:'',authorName:'A. Historian',status:'submitted',historical:true,sourceKey:'demo:legacy:memory:w3:rm',sourcePeriod:'Spring 2025',sourceWeek:'Week 3',body:'<h2>Progress</h2><p>Transcribed from the archived workspace. The original author is recorded as provenance, not as an account.</p>',version:1,submittedAt:'2025-04-14T18:00:00Z',versions:[{version:1,body:'<h2>Progress</h2><p>Transcribed from the archived workspace. The original author is recorded as provenance, not as an account.</p>',at:'2025-04-14T18:00:00Z'}]}],
 obligations:[{id:'o1',initiativeId:'sound',assigneeId:'maya',kind:'rm',due:'2026-09-12T06:59:00Z',status:'pending'},{id:'o2',initiativeId:'sound',assigneeId:'maya',kind:'review',targetId:'rm-memory',due:'2026-09-14T06:59:00Z',status:'pending'},{id:'o3',initiativeId:'memory',assigneeId:'alex',kind:'rm',due:'2026-09-12T06:59:00Z',status:'pending'}],
 threads:[{id:'c1',documentId:'rm-sound',version:1,quote:'Test one dimension at a time',resolved:false,messages:[{authorId:'alex',body:'Could we define the success criterion before the next pilot?',at:'2026-09-05T18:00:00Z'}]}],
 requests:[],audit:[],
 // The one week Research has already opened, matching the seed obligations'
 // Friday/Sunday deadlines. A Roast Me drafted for any other week stays a draft
 // until that week's cycle is opened too.
 cycles:[{startsOn:'2026-09-07',isBreak:false,rmDue:'2026-09-12T06:59:00Z',reviewDue:'2026-09-14T06:59:00Z'}]
}
/**
 * Signup / profile details (name, major, research interests).
 *
 * The limits and the normalisation below mirror update_my_profile and
 * normalize_profile_text in supabase/migrations/202609100008_member_profiles.sql,
 * so the form, the demo engine and the database agree on what is acceptable.
 * The name is required of anyone creating an account; major and interests are
 * optional and may be cleared.
 */
/**
 * Image upload rules, shared by the forms, the demo engine and the live
 * adapter so all three agree with the database. They mirror the allowlist and
 * the byte bounds enforced by attach_rm_image / set_initiative_cover and the
 * document_attachments CHECK constraints in
 * supabase/migrations/202609100012_rm_revision_and_media.sql.
 */
export const IMAGE_MAX_BYTES=10485760
export const IMAGE_MIME_TYPES=['image/png','image/jpeg','image/gif','image/webp']
const IMAGE_EXTENSIONS:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}
/**
 * The stored object name is derived from the already-validated MIME type, never
 * from the supplied file name: a name like `x.png/../../y` or one carrying
 * `?`, `#` or a path separator must not be able to shape the storage key.
 */
export const imageExtension=(mime:string)=>IMAGE_EXTENSIONS[mime]??'bin'
/** The first problem with a picked image file, or null when it is acceptable. */
export function imageFileError(file:{type:string;size:number}):string|null{
 if(!IMAGE_MIME_TYPES.includes(file.type))return 'Choose a PNG, JPEG, GIF or WebP image.'
 if(!(file.size>=1))return 'That file is empty.'
 if(file.size>IMAGE_MAX_BYTES)return 'Images must be 10 MiB or smaller.'
 return null
}
export const NAME_MIN=2,NAME_MAX=80,MAJOR_MAX=80,INTERESTS_MAX=280
export type ProfileDetails={name:string;major:string;interests:string}
/** Collapse runs of whitespace / control characters and trim, like the SQL side. */
export const normalizeProfileText=(v:unknown)=>String(v??'').replace(/[\s\x00-\x1f\x7f]+/g,' ').trim()
export const normalizeProfileDetails=(d:Partial<ProfileDetails>):ProfileDetails=>({name:normalizeProfileText(d.name),major:normalizeProfileText(d.major),interests:normalizeProfileText(d.interests)})
/** The first problem with already-normalised details, or null when they are fine. */
export function profileDetailsError(d:ProfileDetails):string|null{
 if(d.name.length<NAME_MIN)return 'Enter your name so members and reviewers know who you are.'
 if(d.name.length>NAME_MAX)return `Name must be ${NAME_MAX} characters or fewer.`
 if(d.major.length>MAJOR_MAX)return `Major must be ${MAJOR_MAX} characters or fewer.`
 if(d.interests.length>INTERESTS_MAX)return `Research interests must be ${INTERESTS_MAX} characters or fewer.`
 return null
}
