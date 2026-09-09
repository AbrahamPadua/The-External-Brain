/**
 * Open Labs - local demo engine (mode = 'demo').
 *
 * Everything in this module is FICTIONAL and runs entirely in the browser with
 * no network calls. The seed people (...@example.test) and initiatives are
 * invented for demonstration only. `mode = 'live'` never touches this file - the
 * root Supabase adapter implements the same action names against the RPCs
 * described in docs/BACKEND.md.
 *
 * Exports consumed by the wiring layer (app/src/main.tsx, owned by root):
 *   loadDemo()                 -> Data          persisted demo state, or the seed
 *   saveDemo(data)                              persist demo state
 *   loadDemoUserId()           -> string | null the active "viewing as" user
 *   saveDemoUserId(id)                          persist the active user
 *   demoAction(data, userId, action, payload)   -> Promise<Data>
 *
 * `demoAction` enforces real permissions, performs a useful mutation and appends
 * an audit entry. It never mutates its input - it returns a fresh Data value. It
 * throws Error(message) on any permission / validation failure so the UI can
 * show the message and skip persistence.
 *
 * 'switchDemoUser' is special: the active viewer is owned by the wiring layer.
 * demoAction only validates the id and records an audit line; main.tsx must read
 * payload.userId, call saveDemoUserId(payload.userId) and update the userId prop.
 *
 * The proposal wire format (shared with the live adapter): a proposal Request
 * carries the proposed initiative title in `title` and a JSON string
 * `{"category","abstract"}` in `body`. Use readProposal() to decode it.
 */
import type {
  Data, Person, Initiative, DocumentRecord, Thread, Request,
} from './model'
import { seed, uid } from './model'

const DATA_KEY = 'openlabs:demo:data:v2'
const USER_KEY = 'openlabs:demo:user:v2'

export const HP_START = 100
export const HP_MISS = -10        // penalty for a missed obligation
export const HP_COMPLETION = 4    // granted once when an obligation is completed
const HP_MIN = 0
const HP_MAX = 100

const clampHp = (n: number) => Math.max(HP_MIN, Math.min(HP_MAX, Math.round(n)))
const nowIso = () => new Date().toISOString()
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const RM_TEMPLATE =
  '<h2>Progress</h2><p></p><h2>Obstacles &amp; support</h2><p></p><h2>Next steps</h2><p></p>'
const REVIEW_TEMPLATE =
  '<h2>Summary</h2><p></p><h2>Strengths</h2><p></p><h2>Recommendations</h2><p></p>'

/** Strip anything that could execute if rich text is ever rendered as HTML. */
export function sanitize(html: string): string {
  return String(html ?? '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
    .slice(0, 20_000)
}

function encodeProposal(category: string, abstract: string): string {
  return JSON.stringify({ category, abstract })
}

/** Decode a proposal Request.body written by createProposal / the live adapter. */
export function readProposal(body: string): { category: string; abstract: string } {
  try {
    const o = JSON.parse(body)
    if (o && typeof o.abstract === 'string') {
      return { category: String(o.category || 'General'), abstract: o.abstract }
    }
  } catch {
    /* legacy / plain-text body */
  }
  return { category: 'General', abstract: String(body ?? '') }
}

function normalize(d: Data): Data {
  const any = d as unknown as Record<string, unknown>
  for (const k of ['people', 'initiatives', 'documents', 'obligations', 'threads', 'requests', 'audit']) {
    if (!Array.isArray(any[k])) any[k] = []
  }
  d.people.forEach((p) => { if (!Array.isArray(p.roles)) p.roles = [] })
  d.initiatives.forEach((i) => {
    if (!Array.isArray(i.tasks)) i.tasks = []
    if (typeof i.hp !== 'number') i.hp = HP_START
  })
  d.documents.forEach((doc) => { if (!Array.isArray(doc.versions)) doc.versions = [] })
  return d
}

export function loadDemo(): Data {
  try {
    const raw = localStorage.getItem(DATA_KEY)
    if (raw) return normalize(JSON.parse(raw) as Data)
  } catch {
    /* corrupt or unavailable storage - fall back to the seed */
  }
  return normalize(clone(seed))
}

export function saveDemo(data: Data): void {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
  } catch {
    /* storage disabled - demo still works in memory */
  }
}

export function loadDemoUserId(): string | null {
  try {
    const v = localStorage.getItem(USER_KEY)
    if (v === null) return 'maya'
    return v === '' ? null : v
  } catch {
    return 'maya'
  }
}

export function saveDemoUserId(id: string | null): void {
  try {
    localStorage.setItem(USER_KEY, id ?? '')
  } catch {
    /* ignore */
  }
}

// --- permission helpers -----------------------------------------------------

function deny(message: string): never {
  throw new Error(message)
}

function need<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) deny(message)
  return value
}

const isApproved = (p: Person | null | undefined) => !!p && p.status === 'approved'
const hasRole = (p: Person | null | undefined, role: string) =>
  isApproved(p) && !!p && p.roles.includes(role)
const isResearch = (p: Person | null | undefined) => hasRole(p, 'research')
const isOperations = (p: Person | null | undefined) => hasRole(p, 'operations')
const isAdmin = (p: Person | null | undefined) => isResearch(p) || isOperations(p)

function nameOf(d: Data, id: string): string {
  return d.people.find((p) => p.id === id)?.name ?? id
}

function audit(d: Data, actor: Person | null, action: string, detail: string): void {
  d.audit.unshift({
    id: uid(),
    at: nowIso(),
    actor: actor ? actor.name : 'system',
    action,
    detail,
  })
}

// --- action handlers ------------------------------------------------------

type Ctx = { d: Data; actor: Person | null }
type Handler = (ctx: Ctx, payload: any) => void

const handlers: Record<string, Handler> = {
  createProposal: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in to propose an initiative.')
    if (!isApproved(me)) deny('Your account must be approved before proposing an initiative.')
    const title = String(p.title ?? '').trim()
    const abstract = String(p.abstract ?? '').trim()
    const category = String(p.category ?? '').trim() || 'General'
    if (title.length < 3) deny('Give your initiative a title.')
    if (abstract.length < 20) deny('Write a short abstract (at least 20 characters).')
    const req: Request = {
      id: uid(),
      kind: 'proposal',
      userId: me.id,
      title,
      body: encodeProposal(category, abstract),
      status: 'pending',
    }
    d.requests.unshift(req)
    audit(d, me, 'proposal.create', `Proposed "${title}" (${category})`)
  },

  decideProposal: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isResearch(me)) deny('Only Research can decide proposals.')
    const req = need(
      d.requests.find((r) => r.id === p.requestId && r.kind === 'proposal'),
      'Proposal not found.',
    )
    if (req.status !== 'pending') deny('That proposal has already been decided.')
    const decision = p.decision === 'approved' ? 'approved' : 'rejected'
    const feedback = String(p.feedback ?? '').trim()
    if (decision === 'rejected' && !feedback) deny('Add feedback so the proposer knows why.')
    req.status = decision
    req.feedback = feedback || undefined
    if (decision === 'approved') {
      const { category, abstract } = readProposal(req.body)
      const initiative: Initiative = {
        id: uid(),
        title: req.title,
        abstract,
        leadId: req.userId,
        members: [req.userId],
        status: 'active',
        category,
        hp: HP_START,
        tasks: [],
      }
      d.initiatives.unshift(initiative)
      d.obligations.push({
        id: uid(),
        initiativeId: initiative.id,
        assigneeId: req.userId,
        kind: 'rm',
        due: plusDays(7),
        status: 'pending',
      })
      audit(d, me, 'proposal.approve',
        `Approved "${req.title}" - created initiative [${initiative.id}] led by ${nameOf(d, req.userId)}`)
    } else {
      audit(d, me, 'proposal.reject', `Declined "${req.title}": ${feedback}`)
    }
  },

  requestJoin: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isApproved(me)) deny('Your account must be approved before joining an initiative.')
    const ini = need(d.initiatives.find((i) => i.id === p.initiativeId), 'Initiative not found.')
    if (ini.members.includes(me.id)) deny('You are already on this team.')
    if (d.requests.some((r) =>
      r.kind === 'join' && r.initiativeId === ini.id && r.userId === me.id && r.status === 'pending'
    )) deny('You already have a pending request to join.')
    const note = String(p.body ?? '').trim()
    if (note.length < 10) deny('Add a sentence about why you want to join.')
    d.requests.unshift({
      id: uid(),
      kind: 'join',
      userId: me.id,
      initiativeId: ini.id,
      title: ini.title,
      body: note,
      status: 'pending',
    })
    audit(d, me, 'join.request', `Asked to join "${ini.title}" [${ini.id}]`)
  },

  decideJoin: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    const req = need(
      d.requests.find((r) => r.id === p.requestId && r.kind === 'join'),
      'Request not found.',
    )
    const ini = need(d.initiatives.find((i) => i.id === req.initiativeId), 'Initiative not found.')
    if (ini.leadId !== me.id && !isAdmin(me)) {
      deny('Only the initiative lead or an admin can decide join requests.')
    }
    if (req.status !== 'pending') deny('That request has already been decided.')
    const decision = p.decision === 'approved' ? 'approved' : 'rejected'
    req.status = decision
    req.feedback = String(p.feedback ?? '').trim() || undefined
    if (decision === 'approved' && !ini.members.includes(req.userId)) ini.members.push(req.userId)
    audit(d, me, `join.${decision}`,
      `${decision === 'approved' ? 'Added' : 'Declined'} ${nameOf(d, req.userId)} for "${ini.title}" [${ini.id}]`)
  },

  decideAccount: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isResearch(me) && !isOperations(me)) deny('Only Operations or Research can review accounts.')
    const target = need(d.people.find((x) => x.id === p.userId), 'Person not found.')
    if (target.id === me.id) deny('You cannot decide your own account.')
    const status = p.status
    if (status !== 'approved' && status !== 'rejected' && status !== 'suspended') {
      deny('Pick a valid status.')
    }
    const reason = String(p.reason ?? '').trim()
    if ((status === 'rejected' || status === 'suspended') && !reason) {
      deny('Add a reason for the record.')
    }
    const prev = target.status
    target.status = status
    audit(d, me, `account.${status}`,
      `${target.name}: ${prev} -> ${status}${reason ? ` (${reason})` : ''}`)
  },

  createDraft: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isApproved(me)) deny('Your account must be approved.')
    const kind = p.kind === 'review' ? 'review' : 'rm'
    const ini = need(d.initiatives.find((i) => i.id === p.initiativeId), 'Initiative not found.')
    if (kind === 'rm') {
      if (!ini.members.includes(me.id) && !isAdmin(me)) {
        deny('Only the initiative team can draft a reporting memo.')
      }
    } else {
      const target = need(d.documents.find((doc) => doc.id === p.targetId), 'Reviewed document not found.')
      const targetIni = d.initiatives.find((i) => i.id === target.initiativeId)
      if (targetIni && (targetIni.members.includes(me.id) || targetIni.leadId === me.id)) {
        deny('Manual reviews exclude your own initiative.')
      }
      const assigned = d.obligations.some((o) =>
        o.kind === 'review' && o.assigneeId === me.id && o.targetId === p.targetId &&
        o.status !== 'complete' && o.status !== 'waived',
      )
      if (!assigned && !isAdmin(me)) deny('You have not been assigned this review.')
    }
    const open = d.documents.find((doc) =>
      doc.initiativeId === ini.id && doc.kind === kind && doc.status === 'draft' &&
      (kind === 'rm' ? true : doc.targetId === p.targetId) &&
      (doc.authorId === me.id || (kind === 'rm' && ini.members.includes(me.id))),
    )
    if (open) return // reuse the team's existing draft
    const title = String(p.title ?? '').trim() || (kind === 'rm' ? 'Reporting memo' : 'Manual review')
    const doc: DocumentRecord = {
      id: uid(),
      initiativeId: ini.id,
      kind,
      title,
      authorId: me.id,
      status: 'draft',
      body: kind === 'rm' ? RM_TEMPLATE : REVIEW_TEMPLATE,
      version: 1,
      targetId: kind === 'review' ? p.targetId : undefined,
      versions: [],
    }
    d.documents.unshift(doc)
    audit(d, me, 'draft.create',
      `Started ${kind === 'rm' ? 'a reporting memo' : 'a review'} for "${ini.title}" [${ini.id}]`)
  },

  saveDraft: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    const doc = need(d.documents.find((x) => x.id === p.documentId), 'Draft not found.')
    if (doc.status !== 'draft') deny('This document is submitted and can no longer be edited.')
    const ini = d.initiatives.find((i) => i.id === doc.initiativeId)
    const canEdit =
      doc.authorId === me.id || isAdmin(me) ||
      (doc.kind === 'rm' && !!ini && ini.members.includes(me.id))
    if (!canEdit) deny('You do not have edit access to this draft.')
    doc.body = sanitize(String(p.body ?? ''))
    const title = String(p.title ?? '').trim()
    if (title) doc.title = title
    // autosave: intentionally no audit entry
  },

  submitDocument: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    const doc = need(d.documents.find((x) => x.id === p.documentId), 'Document not found.')
    if (doc.status !== 'draft') deny('This document has already been submitted.')
    const ini = need(d.initiatives.find((i) => i.id === doc.initiativeId), 'Initiative not found.')
    if (doc.kind === 'rm') {
      if (ini.leadId !== me.id && !isAdmin(me)) deny('The initiative lead submits the reporting memo.')
    } else if (doc.authorId !== me.id && !isAdmin(me)) {
      deny('Only the assigned reviewer can submit this review.')
    }
    const at = nowIso()
    doc.versions.push({ version: doc.version, body: doc.body, at })
    doc.status = 'submitted'
    doc.submittedAt = at

    const assigneeId = doc.kind === 'rm' ? ini.leadId : doc.authorId
    const obl = d.obligations.find((o) =>
      o.kind === doc.kind && o.assigneeId === assigneeId &&
      o.status !== 'complete' && o.status !== 'waived' &&
      (doc.kind === 'rm' ? o.initiativeId === ini.id : o.targetId === doc.targetId),
    )
    let hpNote = ''
    if (obl) {
      const wasMissed = obl.status === 'missed'
      const lateNoPenalty = !wasMissed && Date.parse(obl.due) < Date.parse(at)
      obl.status = 'complete'
      const target = d.initiatives.find((i) => i.id === obl.initiativeId)
      if (target) {
        const before = target.hp
        let delta = HP_COMPLETION
        if (wasMissed) delta += -HP_MISS // reverse the earlier penalty
        target.hp = clampHp(target.hp + delta)
        hpNote = ` "${target.title}" HP ${before} -> ${target.hp}` +
          ` (+${HP_COMPLETION} completion${wasMissed ? `, +${-HP_MISS} late-penalty reversed` : ''})`
      }
      if (lateNoPenalty) hpNote += ' (submitted after the deadline)'
    }
    audit(d, me, doc.kind === 'rm' ? 'rm.submit' : 'review.submit',
      `Submitted "${doc.title}" v${doc.version} for "${ini.title}" [${ini.id}].${hpNote}`)
  },

  addThread: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isApproved(me)) deny('Only approved members can comment.')
    const doc = need(d.documents.find((x) => x.id === p.documentId), 'Document not found.')
    const version = Number(p.version) || doc.version
    const submitted = doc.versions.length
      ? doc.versions.map((v) => v.version)
      : (doc.status !== 'draft' ? [doc.version] : [])
    if (!submitted.includes(version)) deny('Comments can only be anchored to a submitted version.')
    const quote = String(p.quote ?? '').trim()
    const body = String(p.body ?? '').trim()
    if (!quote) deny('Paste the passage you are responding to.')
    if (!body) deny('Write your comment.')
    const thread: Thread = {
      id: uid(),
      documentId: doc.id,
      version,
      quote: quote.slice(0, 280),
      resolved: false,
      messages: [{ authorId: me.id, body, at: nowIso() }],
    }
    d.threads.unshift(thread)
    audit(d, me, 'comment.add', `Commented on "${doc.title}" v${version}`)
  },

  replyThread: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isApproved(me)) deny('Only approved members can comment.')
    const thread = need(d.threads.find((t) => t.id === p.threadId), 'Thread not found.')
    if (thread.resolved) deny('This thread is resolved. Re-open it to add more.')
    const body = String(p.body ?? '').trim()
    if (!body) deny('Write a reply.')
    thread.messages.push({ authorId: me.id, body, at: nowIso() })
    const doc = d.documents.find((x) => x.id === thread.documentId)
    audit(d, me, 'comment.reply', `Replied on "${doc ? doc.title : thread.documentId}" v${thread.version}`)
  },

  resolveThread: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isApproved(me)) deny('Only approved members can manage threads.')
    const thread = need(d.threads.find((t) => t.id === p.threadId), 'Thread not found.')
    const doc = d.documents.find((x) => x.id === thread.documentId)
    const ini = doc && d.initiatives.find((i) => i.id === doc.initiativeId)
    const participant = thread.messages.some((m) => m.authorId === me.id)
    const onTeam = !!ini && (ini.leadId === me.id || ini.members.includes(me.id))
    if (!participant && !onTeam && !isAdmin(me)) {
      deny('Only a participant, the initiative team, or an admin can resolve this thread.')
    }
    thread.resolved = typeof p.resolved === 'boolean' ? p.resolved : !thread.resolved
    audit(d, me, thread.resolved ? 'comment.resolve' : 'comment.reopen',
      `${thread.resolved ? 'Resolved' : 'Re-opened'} a thread on "${doc ? doc.title : thread.documentId}"`)
  },

  toggleTask: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    const ini = need(d.initiatives.find((i) => i.id === p.initiativeId), 'Initiative not found.')
    if (!ini.members.includes(me.id) && ini.leadId !== me.id && !isAdmin(me)) {
      deny('Only the initiative team can update tasks.')
    }
    const task = need(ini.tasks.find((t) => t.id === p.taskId), 'Task not found.')
    task.done = !task.done
    audit(d, me, 'task.toggle',
      `Marked "${task.title}" ${task.done ? 'done' : 'not done'} on "${ini.title}" [${ini.id}]`)
  },

  addTask: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    const ini = need(d.initiatives.find((i) => i.id === p.initiativeId), 'Initiative not found.')
    if (ini.leadId !== me.id && !isAdmin(me)) {
      deny('Only the initiative lead or an admin can add tasks.')
    }
    const title = String(p.title ?? '').trim()
    if (!title) deny('Describe the task.')
    ini.tasks.push({ id: uid(), title, done: false })
    audit(d, me, 'task.add', `Added task "${title}" to "${ini.title}" [${ini.id}]`)
  },

  assignReview: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isResearch(me)) deny('Only Research assigns manual reviews.')
    const target = need(d.documents.find((doc) => doc.id === p.targetId), 'Reviewed document not found.')
    if (target.status === 'draft') deny('You can only assign a review of a submitted document.')
    const reviewer = need(d.people.find((x) => x.id === p.reviewerId), 'Reviewer not found.')
    if (!isApproved(reviewer)) deny('The reviewer must be an approved member.')
    const reviewedIni = need(d.initiatives.find((i) => i.id === target.initiativeId), 'Initiative not found.')
    if (reviewedIni.members.includes(reviewer.id) || reviewedIni.leadId === reviewer.id) {
      deny('Manual reviews exclude the reviewer’s own initiative.')
    }
    const due = typeof p.due === 'string' && p.due
      ? new Date(p.due).toISOString()
      : plusDays(5)
    const hpIni =
      d.initiatives.find((i) => i.leadId === reviewer.id) ??
      d.initiatives.find((i) => i.members.includes(reviewer.id)) ??
      reviewedIni
    if (p.obligationId) {
      const obl = need(d.obligations.find((o) => o.id === p.obligationId), 'Obligation not found.')
      obl.assigneeId = reviewer.id
      obl.due = due
      obl.status = 'pending'
      obl.targetId = target.id
      obl.initiativeId = hpIni.id
      audit(d, me, 'review.reassign',
        `Reassigned the review of "${target.title}" to ${reviewer.name}`)
    } else {
      if (d.obligations.some((o) =>
        o.kind === 'review' && o.targetId === target.id && o.assigneeId === reviewer.id &&
        o.status !== 'complete' && o.status !== 'waived',
      )) deny('That reviewer already holds this review.')
      d.obligations.push({
        id: uid(),
        initiativeId: hpIni.id,
        assigneeId: reviewer.id,
        kind: 'review',
        targetId: target.id,
        due,
        status: 'pending',
      })
      audit(d, me, 'review.assign',
        `Assigned the review of "${target.title}" to ${reviewer.name}`)
    }
  },

  setStatus: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isResearch(me)) deny('Only Research can change an initiative’s status.')
    const ini = need(d.initiatives.find((i) => i.id === p.initiativeId), 'Initiative not found.')
    const status = String(p.status ?? '').trim()
    if (!status) deny('Pick a status.')
    const reason = String(p.reason ?? '').trim()
    if (!reason) deny('Add a reason for the change.')
    const prev = ini.status
    ini.status = status
    let waived = 0
    if (status === 'hold' || status === 'closed') {
      d.obligations.forEach((o) => {
        if (o.initiativeId === ini.id && o.status !== 'complete' && o.status !== 'waived') {
          o.status = 'waived'
          waived += 1
        }
      })
    }
    audit(d, me, 'initiative.status',
      `"${ini.title}" [${ini.id}] ${prev} -> ${status} (${reason})` +
      (waived ? `; waived ${waived} outstanding obligation(s)` : ''))
  },

  adjustHp: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isResearch(me) && !isOperations(me)) deny('Only Research or Operations can adjust HP.')
    const ini = need(d.initiatives.find((i) => i.id === p.initiativeId), 'Initiative not found.')
    const delta = Math.round(Number(p.delta))
    if (!Number.isFinite(delta) || delta === 0) deny('Enter a non-zero adjustment.')
    const reason = String(p.reason ?? '').trim()
    if (!reason) deny('A manual HP change needs a documented reason.')
    const before = ini.hp
    ini.hp = clampHp(ini.hp + delta)
    audit(d, me, 'hp.adjust',
      `"${ini.title}" [${ini.id}] HP ${before} -> ${ini.hp} (${delta > 0 ? '+' : ''}${delta}; ${reason})`)
  },

  setRole: ({ d, actor }, p) => {
    const me = need(actor, 'Sign in first.')
    if (!isOperations(me)) deny('Only Operations can change roles.')
    const target = need(d.people.find((x) => x.id === p.userId), 'Person not found.')
    if (target.id === me.id) deny('You cannot change your own roles.')
    const role = p.role === 'research' || p.role === 'operations' ? p.role : ''
    if (!role) deny('Pick a valid role.')
    if (!isApproved(target)) deny('Approve the account before granting a role.')
    const grant = !!p.grant
    const has = target.roles.includes(role)
    if (grant && !has) target.roles.push(role)
    if (!grant && has) target.roles = target.roles.filter((r) => r !== role)
    audit(d, me, grant ? 'role.grant' : 'role.revoke',
      `${grant ? 'Granted' : 'Revoked'} ${role} ${grant ? 'to' : 'from'} ${target.name}`)
  },

  switchDemoUser: ({ d, actor }, p) => {
    const id = p.userId === null || p.userId === undefined ? null : String(p.userId)
    if (id && !d.people.find((x) => x.id === id)) deny('No such demo user.')
    audit(d, actor, 'demo.switch',
      `Now viewing as ${id ? nameOf(d, id) : 'a signed-out visitor'}`)
  },
}

export async function demoAction(
  data: Data,
  userId: string | null,
  action: string,
  payload: any,
): Promise<Data> {
  const d = normalize(clone(data))
  const actor = userId ? d.people.find((p) => p.id === userId) ?? null : null
  const handler = handlers[action]
  if (!handler) deny(`Unknown action: ${action}`)
  handler({ d, actor }, payload ?? {})
  return d
}
