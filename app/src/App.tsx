/**
 * The External Brain - front-end dashboard for Decoded Brain at UC San Diego.
 *
 * App is a pure view over `data`. Every state change goes through
 * `onAction(action, payload)` which the host wires to either the local demo
 * engine (app/src/demo.ts, mode = 'demo') or the Supabase adapter
 * (root-owned, mode = 'live'). Both back ends implement the SAME action names
 * and payloads, documented here so they stay in lock-step.
 *
 * "RM" throughout this app is a Roast Me: constructive criticism of a team's
 * work. It is never a reporting memo. A Roast Me draft belongs to the initiative
 * team and exists independently of any cycle - it carries `targetMonday`, the
 * Monday of the Los Angeles week it is meant for. That week's cycle only has to
 * be open at SUBMISSION, when the draft is attached to the week's one RM
 * obligation and the existing deadline / HP / lead-only rules take over.
 *
 *   createProposal   { id?, title, abstract, category, plan, status:'draft'|'submitted' }
 *       Approved account drafts or submits an initiative proposal. Stored as a
 *       Request(kind:'proposal') whose `title` is the initiative title and whose
 *       `body` is the JSON string `{"category","abstract","plan"}` (decode with
 *       readProposal from ./demo). `id` edits an existing draft / changes-requested
 *       proposal in place. `plan` is the execution plan. Only `submitted`
 *       proposals reach the Research queue.
 *   decideProposal   { requestId, decision:'approved'|'rejected'|'changes_requested', feedback? }
 *       Research only, on a `submitted` proposal. Approval creates the initiative +
 *       lead membership + a first reporting-memo obligation. `feedback` required to
 *       reject or request changes; `changes_requested` returns it to the proposer
 *       to edit and resubmit.
 *   requestJoin      { initiativeId, body }
 *       Approved account asks to join a team. `body` is a short plain-text note.
 *   decideJoin       { requestId, decision:'approved'|'rejected', feedback? }
 *       Initiative lead or admin. Approval adds membership.
 *   updateProfile    { name, major, interests }
 *       The signed-in account edits its OWN signup details, and may do so while
 *       still pending. `name` is required (2..80 chars); `major` (<=80) and
 *       `interests` (<=280) are optional and may be cleared. Never carries a
 *       target user: account status, roles and the sign-in email are not
 *       editable here. Live back end: the update_my_profile RPC.
 *   decideAccount    { userId, status:'approved'|'rejected'|'suspended', reason? }
 *       Operations or Research, never your own account. `reason` required to
 *       reject/suspend. Approval unlocks internal read + comment (no project
 *       participation implied).
 *   createDraft      { initiativeId, kind:'rm'|'review', targetMonday?, title?, targetId? }
 *       rm: any member of an ACTIVE initiative, with or without an open cycle.
 *       `targetMonday` defaults to the current Los Angeles Monday; the team gets
 *       one draft per week and re-opening returns the existing one. review: the
 *       assigned reviewer, and never their own initiative. Never creates an
 *       obligation. Live back end: save_rm_draft / save_document_draft.
 *   setDraftTarget   { documentId, targetMonday }
 *       Team only, and only while the Roast Me draft is unsubmitted and not yet
 *       attached to a cycle. Live back end: set_rm_draft_target.
 *   saveDraft        { documentId, title?, body }   (autosave; no audit entry)
 *   submitDocument   { documentId, title?, body? }
 *       rm: the initiative lead, and only once the `targetMonday` week's cycle is
 *       open and is not a break week. review: the assigned reviewer (no admin
 *       override). `title`/`body` carry the live editor state so a pending
 *       autosave cannot lose edits. Attaches the draft to that week's single RM
 *       obligation, appends a version, closes the obligation, grants +4 HP once
 *       and reverses a -10 late penalty if one was recorded. A resubmission after
 *       reviseDocument never re-earns HP. Live back end: submit_rm_draft, which
 *       delegates to the unchanged submit_obligation.
 *   reviseDocument   { documentId }
 *       rm: the initiative lead. review: the assigned reviewer. Reopens a submitted
 *       document as a draft at the next version, keeping the first submittedAt and
 *       every recorded version.
 *   addThread        { documentId, version, quote, body, anchorStart?, anchorEnd? }
 *       Approved account, on a submitted version. With `anchorStart`/`anchorEnd`
 *       it records the character range of the selected passage in THAT version's
 *       plain text, so the highlight can be drawn over it; the range is verified
 *       against the quote. Without them it is an ordinary quoted thread. Live
 *       back end: add_anchored_comment or add_comment.
 *   replyThread      { threadId, body }
 *   resolveThread    { threadId, resolved? }        (toggles when `resolved` omitted)
 *   setTaskStatus    { initiativeId, taskId, status:'planned'|'pending'|'finished' }
 *       Initiative lead, assigned teammate, or admin.
 *   updateTask       { initiativeId, taskId, title, description, dueAt?, assigneeId?, status }
 *       Initiative lead or admin. `description` may be markup with inline image
 *       references; the adapter strips the signed src before storing it.
 *   addTask          { initiativeId, title, description, dueAt?, assigneeId?, status }
 *   deleteTask       { initiativeId, taskId }        (lead / admin; removes its images)
 *   uploadTaskImage  { taskId, initiativeId, file }  -> payload.result {path,url}
 *       Lead or admin. Uploads to the private initiative-images bucket and
 *       registers it with attach_task_image, rolling the object back if the
 *       registration fails. The durable reference is `path`; `url` expires.
 *   detachTaskImage  { taskId, attachmentId, objectPath }
 *       Lead or admin. Refuses while the description still shows the image.
 *   assignReview     { targetId, reviewerId, obligationId?, due? }
 *       Research only. Points one of the reviewer's existing OPEN review
 *       obligations at the memo; `obligationId` is mandatory when the reviewer
 *       holds more than one. `due` defaults to that obligation's own deadline.
 *   setStatus        { initiativeId, status:'active'|'on_hold'|'completed'|'stopped'|'dead', reason }
 *       Research only. Any non-active status waives outstanding obligations.
 *   adjustHp         { initiativeId, delta, reason }
 *       Research only. The manual lever when HP reaches 0.
 *   setRole          { userId, role:'research'|'operations'|'admin', grant:boolean }
 *       Operations or Admin only, never self. Admin satisfies all role checks.
 *   openCycle        { monday, isBreak }
 *       Research only. `monday` defaults in the form to the current Los Angeles
 *       Monday and can be overridden. Idempotent per week; it never creates a
 *       second RM obligation for an initiative.
 *   evaluateDeadlines {}
 *   setPolicy        { penalty, reward }
 *       Research only. Simple weekly-cycle controls on the assignments / health
 *       pages. evaluateDeadlines marks past-due obligations missed (skipping
 *       unassigned reviews) and applies the penalty.
 *   switchDemoUser   { userId | null }
 *       DEMO ONLY. demoAction just audits it; the host's main.tsx must read
 *       payload.userId, persist it with saveDemoUserId and update the userId prop.
 *
 * HP: every initiative starts at 100, capped 0..100. A missed obligation is -10;
 * completing one is +4 (once); a late completion reverses the -10. At 0 a human
 * must act (adjustHp / setStatus). Rich text is only ever rendered through the
 * read-only Tiptap Editor after sanitize(); no raw HTML is injected anywhere.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode, RefObject } from 'react'
import type { Data, DocumentRecord, Initiative, Obligation, Person, ProfileDetails, Thread, Notification } from './model'
import { Editor } from './Editor'
import decodedBrainLogo from './assets/decoded-brain-logo.svg'
import { readDarkTheme } from './theme'
import NeuralBackground from './NeuralBackground'
import { readProposal, sanitize } from './demo'
import {
  addWeeksIso, formatLosAngelesLocal, isMondayIso, losAngelesMonday, parseLosAngelesLocal,
} from './domain'
import {
  IMAGE_MIME_TYPES, imageFileError,
  INTERESTS_MAX, MAJOR_MAX, NAME_MAX, TASK_DETAILS_MAX,
  normalizeProfileDetails, profileDetailsError,
} from './model'
import {
  anchorError, applyHighlights, mapRenderedText, renderFormatted, resolvableSpans,
  selectionAnchor, textOfHtml,
} from './highlight'
import type { Anchor, TextMap } from './highlight'
import {
  ArrowLeft, Bell, Check, CheckCheck, CircleAlert, ClipboardList, Clock,
  FlaskConical, HeartPulse, House, IdCard, Image, Inbox, LogIn, LogOut, MessageSquare,
  Menu, Moon, Plus, Save, Send, Settings, ShieldCheck, Sparkles, Sun, Trash2, TriangleAlert, UserPlus, X,
} from 'lucide-react'

type AppProps = {
  data: Data
  userId: string | null
  onAction: (action: string, payload: any) => Promise<void>
  mode: 'demo' | 'live'
  onSignIn: (email: string, details?: ProfileDetails) => Promise<void>
  onVerifyCode?: (email: string, code: string) => Promise<void>
  onVerifyLink?: (tokenHash: string) => Promise<void>
  onSignOut: () => Promise<void>
  /** The signed-in account's own email, read from the session. Read-only here. */
  authEmail?: string | null
}

type Route = { name: string; parts: string[] }

type Ctx = {
  data: Data
  me: Person | null
  userId: string | null
  approved: boolean
  isResearch: boolean
  isOperations: boolean
  isAdmin: boolean
  mode: 'demo' | 'live'
  busy: boolean
  route: Route
  authEmail: string | null
  personName: (id: string) => string
  run: (action: string, payload: any, okMsg?: string) => Promise<boolean>
  onSignIn: (email: string, details?: ProfileDetails) => Promise<boolean>
  onVerifyCode?: (email: string, code: string) => Promise<void>
  onVerifyLink?: (tokenHash: string) => Promise<boolean>
  onSignOut: () => Promise<void>
  uploadRmImage: (docId: string, initiativeId: string, file: File) => Promise<{ path: string, url: string }>
  uploadTaskImage: (taskId: string, initiativeId: string, file: File) => Promise<{ path: string, url: string }>
}

// --- small helpers --------------------------------------------------------

const CATEGORIES = [
  'Neuroengineering', 'Cognitive science', 'Neuroscience',
  'Computational modelling', 'Human-computer interaction', 'Other',
]

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
  if (raw.startsWith('error=')) {
    const params = new URLSearchParams(raw)
    return { name: 'auth-error', parts: [params.get('error_code') ?? ''] }
  }
  const parts = raw.split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s) } catch { return s }
  })
  return { name: parts[0] ?? '', parts }
}

const go = (path: string) => { window.location.hash = path }

function fmtDateTime(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtDate(iso?: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function relDue(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms)) return ''
  const days = Math.round(ms / 86_400_000)
  if (days === 0) return 'due today'
  if (days > 0) return `due in ${days} day${days === 1 ? '' : 's'}`
  return `${-days} day${days === -1 ? '' : 's'} overdue`
}

function statusTone(s: string): string {
  switch (s) {
    case 'active': case 'approved': case 'complete': case 'completed': case 'done': return 'good'
    case 'pending': case 'hold': case 'on_hold': case 'submitted': case 'changes_requested': return 'warn'
    case 'rejected': case 'suspended': case 'missed': case 'stopped': case 'dead': return 'bad'
    case 'draft': return 'info'
    default: return 'muted'
  }
}

/**
 * The account's review status, for the Accounts table's Status column only.
 * Everywhere an account is *identified*, use accountRoleBadges instead - a
 * status is not a role.
 */
function accountStatusLabel(p: Pick<Person, 'status'>): string {
  return p.status === 'approved' ? 'Approved' : p.status
}

/** The one message a refused role-preview attempt reports, wherever it came from. */
export const PREVIEW_REFUSAL = 'Role preview is read-only. Exit the preview to make changes.'

export type MutationGateway = {
  /** Wraps any promise in the busy/error/notice handling. Non-mutating callers too. */
  guard: (fn: () => Promise<unknown>, okMsg?: string) => Promise<boolean>
  run: (action: string, payload: any, okMsg?: string) => Promise<boolean>
  uploadRmImage: (docId: string, initiativeId: string, file: File) => Promise<{ path: string; url: string }>
  uploadTaskImage: (taskId: string, initiativeId: string, file: File) => Promise<{ path: string; url: string }>
}

/**
 * Every mutation entrypoint in the app, built once over a SINGLE guarded
 * dispatch.
 *
 * This exists because the entrypoints drifted: `run` checked the role preview
 * but the two image uploads called the host directly, so a previewing account
 * could still upload bytes and register an attachment. Funnelling them through
 * one `dispatch` means the refusal cannot be skipped by adding another caller,
 * and a new entrypoint has to go out of its way to avoid it.
 *
 * `isPreviewing` is a function, not a captured boolean, so a callback created
 * before the preview began - a queued autosave, a file-picker handler, an upload
 * retry - is refused when it actually fires.
 */
export function createMutationGateway(opts: {
  onAction: (action: string, payload: any) => Promise<void>
  isPreviewing: () => boolean
  setBusy: (busy: boolean) => void
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
}): MutationGateway {
  const { onAction, isPreviewing, setBusy, setError, setNotice } = opts

  const dispatch = async (action: string, payload: any): Promise<void> => {
    // Before the network, before any bytes leave the browser.
    if (isPreviewing()) throw new Error(PREVIEW_REFUSAL)
    return onAction(action, payload)
  }

  const guard = async (fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> => {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await fn()
      if (okMsg) setNotice(okMsg)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const upload = async (action: string, payload: any) => {
    const ok = await guard(() => dispatch(action, payload))
    // A picker/upload callback may have started just before preview was entered.
    // The host call cannot be un-sent, but its result must not cross the preview
    // boundary and reach the editor (which would insert an image into read-only
    // content). Read the live value again after the awaited dispatch.
    if (isPreviewing()) throw new Error(PREVIEW_REFUSAL)
    if (!ok || !payload.result) {
      // Throwing is what stops the editor inserting an image for a refused upload.
      throw new Error(isPreviewing() ? PREVIEW_REFUSAL : 'Upload failed')
    }
    return payload.result as { path: string; url: string }
  }

  return {
    guard,
    run: (action, payload, okMsg) => guard(() => dispatch(action, payload), okMsg),
    uploadRmImage: (documentId, initiativeId, file) =>
      upload('uploadRmImage', { documentId, initiativeId, file, result: null }),
    uploadTaskImage: (taskId, initiativeId, file) =>
      upload('uploadTaskImage', { taskId, initiativeId, file, result: null }),
  }
}

const ROLE_ORDER = ['admin', 'research', 'operations']

/**
 * Distinct role names for display. A grant can appear more than once in the
 * loaded rows (two live grants of the same role), which previously rendered a
 * second identical badge and a duplicate React key.
 */
export function roleLabels(roles: readonly string[]): string[] {
  const seen = new Set(roles.map((r) => String(r ?? '').trim().toLowerCase()).filter(Boolean))
  const known = ROLE_ORDER.filter((r) => seen.has(r))
  const rest = [...seen].filter((r) => !ROLE_ORDER.includes(r)).sort()
  return [...known, ...rest]
}

/**
 * What an account is CALLED, which is not the same as its status. An approved
 * account holding no privileged grant is a Member; "Approved" is a status and
 * was never a role, so it is not shown as one. An account that is not approved
 * shows that status instead, because it has no standing to name.
 */
export function accountRoleBadges(
  p: Pick<Person, 'status' | 'roles'>,
): { label: string; tone: string }[] {
  if (p.status !== 'approved') return [{ label: p.status, tone: statusTone(p.status) }]
  const roles = roleLabels(p.roles)
  if (!roles.length) return [{ label: 'Member', tone: 'good' }]
  return roles.map((label) => ({ label, tone: 'info' }))
}

export function navigationAccess(opts: {
  approved: boolean
  isResearch: boolean
  isOperations: boolean
  isInitiativeLead: boolean
}) {
  const organizational = opts.approved && (opts.isResearch || opts.isOperations)
  return {
    accounts: organizational,
    audit: organizational,
    joinRequests: opts.approved && (organizational || opts.isInitiativeLead),
  }
}

// --- Roast Me weeks -------------------------------------------------------
//
// A Roast Me ("RM") is constructive criticism of a team's work. Drafting one is
// independent of Research opening a cycle: the draft only names the Monday of
// the Los Angeles week it is meant for, and that week's cycle has to be open
// before it can be submitted.

/** The weeks a draft may be pointed at: last week through two weeks ahead. */
function weekChoices(current: string, keep?: string): string[] {
  const weeks = [-1, 0, 1, 2].map((n) => addWeeksIso(current, n))
  if (keep && isMondayIso(keep) && !weeks.includes(keep)) weeks.push(keep)
  return [...new Set(weeks)].sort()
}

type WeekState = { tone: string; label: string; note: string }

/** Whether that week's cycle is open, and what to tell the team if it is not. */
function weekState(ctx: Ctx, monday: string | undefined): WeekState {
  if (!monday) return { tone: 'warn', label: 'no week chosen', note: 'Choose the week this Roast Me is for.' }
  const cycle = (ctx.data.cycles ?? []).find((c) => c.startsOn === monday)
  if (!cycle) {
    return {
      tone: 'warn', label: 'cycle not opened yet',
      note: `Research has not opened the week of ${monday} yet. Keep drafting - you can submit as soon as it opens, or point this draft at an open week.`,
    }
  }
  if (cycle.isBreak) {
    return {
      tone: 'muted', label: 'break week',
      note: `The week of ${monday} is a break week and takes no Roast Me. Point this draft at a working week.`,
    }
  }
  return { tone: 'good', label: 'cycle open', note: '' }
}

function WeekSelect({ ctx, value, onPick, disabled }: {
  ctx: Ctx; value: string; onPick: (monday: string) => void; disabled?: boolean
}) {
  const current = losAngelesMonday()
  return (
    <select value={value} disabled={disabled || ctx.busy} onChange={(e) => onPick(e.target.value)}>
      {weekChoices(current, value).map((week) => {
        const open = (ctx.data.cycles ?? []).find((c) => c.startsOn === week)
        const tag = !open ? 'not opened' : open.isBreak ? 'break week' : 'open'
        return (
          <option key={week} value={week}>
            Week of {week}{week === current ? ' (this week)' : ''} - {tag}
          </option>
        )
      })}
    </select>
  )
}

function versionsOf(doc: DocumentRecord): { version: number; body: string; at: string }[] {
  if (doc.versions.length) return [...doc.versions].sort((a, b) => a.version - b.version)
  if (doc.status !== 'draft') return [{ version: doc.version, body: doc.body, at: doc.submittedAt ?? '' }]
  return []
}

/**
 * An account whose profile has no name yet - created before signup collected
 * one, or signed in through the returning-member form - still has to render as
 * something. The Settings profile section is where it gets fixed.
 */
const nameOf = (p: Person): string => p.name.trim() || 'Unnamed member'

function initiativesFor(data: Data, userId: string | null): Initiative[] {
  if (!userId) return []
  return data.initiatives.filter((i) => i.leadId === userId || i.members.includes(userId))
}

// --- presentational bits ------------------------------------------------

function Pill({ children, tone }: { children: ReactNode; tone?: string }) {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>
}

function HpBar({ hp }: { hp: number }) {
  const tone = hp >= 60 ? '' : hp >= 30 ? 'warn' : 'bad'
  const w = Math.max(0, Math.min(100, hp))
  return (
    <div className="hp" title={`${hp} / 100 HP`} role="img" aria-label={`Health ${hp} of 100`}>
      <div className={`hp-fill ${tone}`} style={{ width: `${w}%` }} />
      <span className="hp-num">{hp}</span>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

function RoleBadges({ person }: { person: Person }) {
  const roles = roleLabels(person.roles)
  if (!roles.length) return null
  return (
    <span className="badges">
      {roles.map((r) => <Pill key={r} tone="info">{r}</Pill>)}
    </span>
  )
}

export type DocumentSort = 'newest' | 'title' | 'kind' | 'status'
export type TaskSort = 'due' | 'title' | 'status'

const documentDateKey = (doc: DocumentRecord): string =>
  doc.targetMonday ?? doc.submittedAt ?? ''

/** Imported source order is chronological and must win over the import timestamp. */
export function sortDocuments(documents: DocumentRecord[], sort: DocumentSort): DocumentRecord[] {
  return [...documents].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'kind') return a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)
    if (sort === 'status') return a.status.localeCompare(b.status) || a.title.localeCompare(b.title)
    if (a.historical !== b.historical) return a.historical ? 1 : -1
    if (a.historical && b.historical) {
      return (b.sourceOrder ?? Number.MIN_SAFE_INTEGER) - (a.sourceOrder ?? Number.MIN_SAFE_INTEGER)
        || (a.kind === 'rm' ? 0 : 1) - (b.kind === 'rm' ? 0 : 1)
    }
    return documentDateKey(b).localeCompare(documentDateKey(a)) || a.title.localeCompare(b.title)
  })
}

export function sortTasks(tasks: Initiative['tasks'], sort: TaskSort): Initiative['tasks'] {
  return [...tasks].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'status') return a.status.localeCompare(b.status) || a.title.localeCompare(b.title)
    return (a.dueAt ? 0 : 1) - (b.dueAt ? 0 : 1)
      || (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.title.localeCompare(b.title)
  })
}

function Toasts({ error, notice, onClear }: {
  error: string | null; notice: string | null; onClear: () => void
}) {
  if (!error && !notice) return null
  return (
    <div className="toasts">
      {error ? (
        <div className="toast err" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
          <button type="button" aria-label="Dismiss" onClick={onClear}><X size={16} /></button>
        </div>
      ) : null}
      {notice ? (
        <div className="toast ok" role="status">
          <Check size={18} />
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={onClear}><X size={16} /></button>
        </div>
      ) : null}
    </div>
  )
}

// --- shell --------------------------------------------------------------

function Sidebar({ nav, route, open, onNavigate }: {
  nav: { to: string; label: string; icon: typeof House; show: boolean }[]
  route: Route
  open: boolean
  onNavigate: () => void
}) {
  const settings = nav.find((n) => n.to === '#/settings')
  const link = (n: typeof nav[number]) => {
    const target = n.to.replace(/^#\/?/, '').split('/')[0]
    // `#/profile` remains a supported bookmark for the personal-profile
    // section, even though Settings is now its permanent home.
    const active = target === route.name ||
      (target === 'settings' && route.name === 'profile') ||
      (target === '' && route.name === '')
    const Icon = n.icon
    return (
      <a key={n.to} href={n.to} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
        <Icon /><span>{n.label}</span>
      </a>
    )
  }
  return (
    <nav id="primary-navigation" className={`ol-nav-dropdown ${open ? 'open' : ''}`} aria-label="Primary navigation">
      <div className="ol-nav">
        {nav.filter((n) => n.show && n !== settings).map(link)}
      </div>
      {settings?.show ? <div className="ol-nav ol-nav-settings">{link(settings)}</div> : null}
    </nav>
  )
}

function TopBar({ ctx, nav, route, navOpen, onToggleNav, onNavigate, navToggleRef, navMenuRef }: {
  ctx: Ctx; nav: { to: string; label: string; icon: typeof House; show: boolean }[]; route: Route
  navOpen: boolean; onToggleNav: () => void; onNavigate: () => void
  navToggleRef: RefObject<HTMLButtonElement | null>; navMenuRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="ol-topbar">
      <div className="ol-brand-group">
        <div className="ol-nav-menu" ref={navMenuRef}>
          <button
            type="button" className="ol-nav-toggle" aria-label={`${navOpen ? 'Close' : 'Open'} navigation`}
            aria-expanded={navOpen} aria-controls="primary-navigation" onClick={onToggleNav} ref={navToggleRef}
          >
            <Menu size={20} />
          </button>
          <Sidebar nav={nav} route={route} open={navOpen} onNavigate={onNavigate} />
        </div>
        <div className="ol-brand">
          <img className="ol-brand-logo" src={decodedBrainLogo} width="34" height="34" alt="" />
          <span className="ol-brand-title">The External Brain</span>
          <span className="ol-brand-divider">/</span>
          <span className="ol-brand-sub">Decoded Brain</span>
        </div>
      </div>
      <div className="who">
        {ctx.me ? (
          <>
            <a href="#/settings"><strong>{nameOf(ctx.me)}</strong></a>
            {/* One badge set: the account's role, deduplicated. Not a status
                pill plus a role pill, which read as two conflicting answers. */}
            {accountRoleBadges(ctx.me).map(({ label, tone }) => (
              <Pill key={label} tone={tone}>{label}</Pill>
            ))}
          </>
        ) : (
          <span>Signed-out visitor</span>
        )}
      </div>
      <a className="btn ghost sm" href="#/settings"><Settings size={15} /> Settings</a>
    </div>
  )
}

// --- forms ------------------------------------------------------------

/**
 * Sign in, or create an account. Both request an email; a new
 * account additionally gives a name (required) and, if they want, a major and a
 * line about their research interests. Returning members send email only, so an
 * account that already exists keeps the profile it has.
 */
function SignInPanel({ ctx }: { ctx: Ctx }) {
  const [newAccount, setNewAccount] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [major, setMajor] = useState('')
  const [interests, setInterests] = useState('')
  const [code, setCode] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)
  if (ctx.mode === 'demo') {
    return (
      <div className="card">
        <h3>Exploring the demo</h3>
        <p className="muted">
          This is a fictional dataset. Use the <strong>view as</strong> menu in the
          top bar to step through the app as different members - a pending applicant,
          an initiative lead, Research and Operations.
        </p>
      </div>
    )
  }
  const details = normalizeProfileDetails({ name, major, interests })
  const problem = profileDetailsError(details)
  return (
    <div className="card">
      <h3>{newAccount ? 'Create your account' : 'Sign in'}</h3>
      <div className="tabs">
        <button
          type="button" className={`tab ${newAccount ? '' : 'active'}`}
          onClick={() => setNewAccount(false)}
        >
          I have an account
        </button>
        <button
          type="button" className={`tab ${newAccount ? 'active' : ''}`}
          onClick={() => setNewAccount(true)}
        >
          I am new here
        </button>
      </div>
      <form
        className="stack"
        onSubmit={async (e: FormEvent) => {
          e.preventDefault()
          if (!email.trim()) return
          if (newAccount && problem) return
          const sent = await ctx.onSignIn(email.trim(), newAccount ? details : undefined)
          if (sent && !newAccount) {
            setEmailSent(true)
            requestAnimationFrame(() => codeInputRef.current?.focus())
          }
        }}
      >
        {newAccount ? (
          <>
            <Field label="Full name" hint={`How members and reviewers see you. Up to ${NAME_MAX} characters.`}>
              <input
                type="text" required maxLength={NAME_MAX} value={name} disabled={ctx.busy}
                placeholder="Ada Lovelace" onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Major (optional)">
              <input
                type="text" maxLength={MAJOR_MAX} value={major} disabled={ctx.busy}
                placeholder="Cognitive Science" onChange={(e) => setMajor(e.target.value)}
              />
            </Field>
            <Field
              label="Research interests (optional)"
              hint={`A sentence is plenty - up to ${INTERESTS_MAX} characters. You can change all of this later.`}
            >
              <textarea
                maxLength={INTERESTS_MAX} value={interests} disabled={ctx.busy}
                style={{ minHeight: 72 }} onChange={(e) => setInterests(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="University email">
          <input
            type="email" required placeholder="you@ucsd.edu" value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailSent(false) }} disabled={ctx.busy}
          />
        </Field>
        <button className="btn" disabled={ctx.busy || (newAccount && !!problem)}>
          <LogIn size={16} /> Send sign-in email
        </button>
        {newAccount && problem && name.length ? (
          <span className="field-hint" role="alert">{problem}</span>
        ) : null}
        <span className="field-hint">
          {newAccount
            ? 'New accounts stay pending until Operations or Research approve them. Your details are saved with your account and you can edit them from Settings at any time.'
            : 'We email you sign-in instructions. Your name, major and interests stay exactly as they are.'}
        </span>
      </form>
      {!newAccount && ctx.onVerifyCode ? (
        <form className="stack signin-code-form" onSubmit={async (event: FormEvent) => {
          event.preventDefault()
          if (!email.trim() || !/^\d{6}$/.test(code)) return
          await ctx.onVerifyCode?.(email.trim(), code)
        }}>
          <h4>{emailSent ? 'Email sent — enter your code here' : 'Have a six-digit email code?'}</h4>
          <Field label="Email code" hint="Use the code in your latest email from The External Brain, if one is included.">
            <input ref={codeInputRef} type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
              maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} disabled={ctx.busy} />
          </Field>
          <button className="btn ghost" disabled={ctx.busy || !email.trim() || !/^\d{6}$/.test(code)}>
            Sign in with code
          </button>
        </form>
      ) : null}
    </div>
  )
}

/** Shown until an account has a name on its profile. */
function ProfileNudge({ ctx }: { ctx: Ctx }) {
  if (!ctx.me || ctx.me.name.trim()) return null
  return (
    <div className="card">
      <h3>Finish your profile</h3>
      <p className="muted">
        Add your name so members and reviewers know who you are. A major and your
        research interests are optional.
      </p>
      <a className="btn" href="#/settings"><IdCard size={16} /> Open Settings</a>
    </div>
  )
}

/**
 * Self-service edit of the signup details. Available to a pending account as
 * well as an approved one; it cannot touch the account status, the roles or the
 * sign-in email, and it only ever writes the signed-in member's own row.
 */
function ProfileForm({ ctx, me }: { ctx: Ctx; me: Person }) {
  const [name, setName] = useState(me.name)
  const [major, setMajor] = useState(me.major ?? '')
  const [interests, setInterests] = useState(me.interests ?? '')
  const details = normalizeProfileDetails({ name, major, interests })
  const problem = profileDetailsError(details)
  const unchanged = details.name === me.name.trim() &&
    details.major === (me.major ?? '').trim() &&
    details.interests === (me.interests ?? '').trim()
  return (
    <form
      className="card"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        if (problem) return
        await ctx.run('updateProfile', details, 'Profile saved.')
      }}
    >
      <h3>Your details</h3>
      <Field label="Full name" hint={`Required. Up to ${NAME_MAX} characters.`}>
        <input
          type="text" required maxLength={NAME_MAX} value={name} disabled={ctx.busy}
          placeholder="Ada Lovelace" onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="Major (optional)" hint="Leave empty to remove it.">
        <input
          type="text" maxLength={MAJOR_MAX} value={major} disabled={ctx.busy}
          placeholder="Cognitive Science" onChange={(e) => setMajor(e.target.value)}
        />
      </Field>
      <Field
        label="Research interests (optional)"
        hint={`What you would like to work on - up to ${INTERESTS_MAX} characters.`}
      >
        <textarea
          maxLength={INTERESTS_MAX} value={interests} disabled={ctx.busy}
          style={{ minHeight: 88 }} onChange={(e) => setInterests(e.target.value)}
        />
      </Field>
      <div className="btn-row">
        <button className="btn" disabled={ctx.busy || !!problem || unchanged}>
          <Save size={16} /> Save profile
        </button>
      </div>
      {problem && name.length ? <p className="field-hint" role="alert">{problem}</p> : null}
    </form>
  )
}

function DecisionForm({ ctx, approveLabel, rejectLabel, onApprove, onReject, onChanges }: {
  ctx: Ctx
  approveLabel?: string
  rejectLabel?: string
  onApprove: () => Promise<boolean>
  onReject: (feedback: string) => Promise<boolean>
  onChanges?: (feedback: string) => Promise<boolean>
}) {
  const [mode, setMode] = useState<null | 'reject' | 'changes'>(null)
  const [fb, setFb] = useState('')
  if (mode) {
    const isChanges = mode === 'changes'
    return (
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          const ok = await (isChanges ? onChanges! : onReject)(fb.trim())
          if (ok) { setFb(''); setMode(null) }
        }}
      >
        <textarea
          value={fb} onChange={(e) => setFb(e.target.value)} disabled={ctx.busy}
          placeholder={isChanges
            ? 'What should the proposer change? (required)'
            : 'Feedback for the requester (required)'}
        />
        <div className="btn-row">
          <button className={`btn sm ${isChanges ? '' : 'danger'}`} disabled={ctx.busy || !fb.trim()}>
            {isChanges ? 'Send change request' : (rejectLabel ?? 'Decline')}
          </button>
          <button type="button" className="btn ghost sm" disabled={ctx.busy}
            onClick={() => setMode(null)}>Cancel</button>
        </div>
      </form>
    )
  }
  return (
    <div className="btn-row">
      <button className="btn sm" disabled={ctx.busy} onClick={() => onApprove()}>
        <Check size={15} /> {approveLabel ?? 'Approve'}
      </button>
      {onChanges ? (
        <button className="btn ghost sm" disabled={ctx.busy} onClick={() => setMode('changes')}>
          Request changes
        </button>
      ) : null}
      <button className="btn danger sm" disabled={ctx.busy} onClick={() => setMode('reject')}>
        {rejectLabel ?? 'Decline'}
      </button>
    </div>
  )
}

function ReasonAction({ ctx, label, tone, placeholder, onSubmit }: {
  ctx: Ctx
  label: string
  tone?: string
  placeholder: string
  onSubmit: (reason: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  if (!open) {
    return (
      <button className={`btn sm ${tone ?? 'ghost'}`} disabled={ctx.busy} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await onSubmit(reason.trim())
        if (ok) { setReason(''); setOpen(false) }
      }}
    >
      <input
        type="text" value={reason} disabled={ctx.busy} placeholder={placeholder}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="btn-row">
        <button className={`btn sm ${tone ?? ''}`} disabled={ctx.busy || !reason.trim()}>{label}</button>
        <button type="button" className="btn ghost sm" disabled={ctx.busy}
          onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

function JoinForm({ ctx, initiativeId }: { ctx: Ctx; initiativeId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  if (!open) {
    return (
      <button className="btn" disabled={ctx.busy} onClick={() => setOpen(true)}>
        <UserPlus size={16} /> Ask to join
      </button>
    )
  }
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await ctx.run('requestJoin', { initiativeId, body: note.trim() }, 'Request sent to the lead.')
        if (ok) { setNote(''); setOpen(false) }
      }}
    >
      <Field label="Why do you want to join?" hint="A sentence or two is plenty.">
        <textarea value={note} disabled={ctx.busy} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button className="btn" disabled={ctx.busy || note.trim().length < 10}>Send request</button>
        <button type="button" className="btn ghost" disabled={ctx.busy}
          onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}
function CoverForm({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  const [open, setOpen] = useState(false)
  const [expectedColor, setExpectedColor] = useState(ini.coverFallbackColor || '')
  const [color, setColor] = useState(ini.coverFallbackColor || '')
  const [dirty, setDirty] = useState(false)
  const [position,setPosition]=useState({x:ini.coverPositionX??50,y:ini.coverPositionY??50})

  useEffect(() => {
    if ((ini.coverFallbackColor || '') !== expectedColor) {
      if (!dirty) {
        setColor(ini.coverFallbackColor || '')
        setExpectedColor(ini.coverFallbackColor || '')
      }
    }
  }, [ini.coverFallbackColor, expectedColor, dirty])

  const conflict = open && dirty && expectedColor !== (ini.coverFallbackColor || '')
  
  if (!open) {
    return (
      <button className="btn sm ghost" onClick={() => {
        setExpectedColor(ini.coverFallbackColor || '')
        setColor(ini.coverFallbackColor || '')
        setDirty(false)
        setOpen(true)
      }}>
        <Image size={14} /> Manage cover
      </button>
    )
  }
  
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h4>Manage cover</h4>
      
      {conflict ? (
        <p style={{ color: '#dc2626', marginBottom: 12, marginTop: 8, fontWeight: 'bold', fontSize: 14 }}>
          Conflict: The fallback color was changed by another user.
        </p>
      ) : null}

      <div className="stack" style={{ marginTop: 12 }}>
        {/* `accept` is only a picker hint, so the allowlist and the size bounds
            are re-checked here before anything is uploaded. The back end checks
            them again in set_initiative_cover. */}
        <input type="file" accept={IMAGE_MIME_TYPES.join(',')} onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          const problem = imageFileError(file)
          if (problem) return alert(problem)
          const ok = await ctx.run('uploadCover', { initiativeId: ini.id, file }, 'Cover uploaded.')
          if (ok) setOpen(false)
        }} disabled={ctx.busy} />
        
        <div className="row" style={{ marginTop: 8 }}>
          <input type="color" value={color || '#cccccc'} onChange={(e) => { setColor(e.target.value); setDirty(true) }} disabled={ctx.busy || conflict} />
          <button type="button" className="btn sm" disabled={ctx.busy || conflict || color === ini.coverFallbackColor} onClick={async () => {
             const ok = await ctx.run('setCoverColor', { initiativeId: ini.id, color }, 'Fallback color set.')
             if (ok) setOpen(false)
          }}>Set fallback color</button>
        </div>
        {ini.coverObjectPath ? <div className="stack">
          <Field label={`Horizontal position: ${position.x}%`}><input type="range" min="0" max="100" value={position.x} onChange={e=>setPosition({...position,x:Number(e.target.value)})}/></Field>
          <Field label={`Vertical position: ${position.y}%`}><input type="range" min="0" max="100" value={position.y} onChange={e=>setPosition({...position,y:Number(e.target.value)})}/></Field>
          <button type="button" className="btn sm" disabled={ctx.busy||position.x===(ini.coverPositionX??50)&&position.y===(ini.coverPositionY??50)} onClick={async()=>{
            const ok=await ctx.run('setCoverPosition',{initiativeId:ini.id,...position},'Cover position saved.');if(ok)setOpen(false)
          }}>Save position</button>
        </div>:null}
        
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn sm" disabled={ctx.busy || (!ini.coverObjectPath && !ini.coverFallbackColor)} onClick={async () => {
             const ok = await ctx.run('clearCover', { initiativeId: ini.id }, 'Cover cleared.')
             if (ok) setOpen(false)
          }}>Clear cover</button>
          <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  )
}

export function Modal({ titleId, onRequestClose, children }: {
  titleId:string; onRequestClose:()=>void; children:ReactNode
}) {
  const panel=useRef<HTMLDivElement>(null)
  const closeRef=useRef(onRequestClose)
  closeRef.current=onRequestClose
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null
    const focusable=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href]')??[])
    ;(panel.current?.querySelector<HTMLElement>('[autofocus]')??focusable()[0])?.focus()
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();closeRef.current();return}
      if(e.key!=='Tab')return
      const nodes=focusable();if(!nodes.length)return
      const first=nodes[0],last=nodes[nodes.length-1]
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',key)
    return()=>{document.removeEventListener('keydown',key);previous?.focus()}
  },[titleId])
  return <div className="modal-overlay" role="presentation"
    onMouseDown={(e)=>{if(e.target===e.currentTarget)onRequestClose()}}>
    <div ref={panel} className="modal-card stack" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {children}
    </div>
  </div>
}

function AddTaskForm({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [due, setDue] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [status, setStatus] = useState<'planned'|'pending'|'finished'>('planned')
  const members = [...new Set([ini.leadId, ...ini.members])]
    .map((id) => ctx.data.people.find((p) => p.id === id))
    .filter((p): p is Person => !!p && p.status === 'approved')
  const dirty=!!(title||description||due||assigneeId||status!=='planned')
  const close = () => { if (!ctx.busy && (!dirty || window.confirm('Discard this unsaved task?'))) setOpen(false) }
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}><Plus size={15} /> Add task</button>
  return (
    <Modal titleId="add-task-title" onRequestClose={close}>
      <form className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          const dueAt = due ? new Date(due).toISOString() : undefined
          const ok = await ctx.run('addTask', { initiativeId: ini.id, title: title.trim(),
            description: description.trim(), dueAt, assigneeId: assigneeId || undefined, status }, 'Task added.')
          if (ok) { setTitle(''); setDescription(''); setDue(''); setAssigneeId(''); setStatus('planned'); setOpen(false) }
        }}>
        <div className="between"><h3 id="add-task-title">Add task</h3>
          <button type="button" className="btn ghost sm" aria-label="Close" onClick={close}><X size={16} /></button></div>
        <Field label="Title"><input autoFocus required maxLength={160} value={title} disabled={ctx.busy} onChange={(e) => setTitle(e.target.value)} /></Field>
        {/* Plain text here on purpose: a task has no id to attach an image to
            until it exists, so images are added from the task's own modal. */}
        <Field label="Description (optional)" hint="Add images after the task is created.">
          <textarea maxLength={TASK_DETAILS_MAX} value={description} disabled={ctx.busy} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Due date and time (optional)"><input type="datetime-local" value={due} disabled={ctx.busy} onChange={(e) => setDue(e.target.value)} /></Field>
        <Field label="Assigned to (optional)"><select value={assigneeId} disabled={ctx.busy} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Unassigned</option>{members.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
        </select></Field>
        <Field label="Status"><select value={status} disabled={ctx.busy} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="planned">Planned</option><option value="pending">Pending</option><option value="finished">Finished</option>
        </select></Field>
        <div className="btn-row"><button className="btn" disabled={ctx.busy || !title.trim()}>Add task</button>
          <button type="button" className="btn ghost" disabled={ctx.busy} onClick={close}>Cancel</button></div>
      </form>
    </Modal>
  )
}

function taskLocalDate(iso?:string){if(!iso)return '';const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}

function TaskModal({ctx,ini,taskId,onClose}:{ctx:Ctx;ini:Initiative;taskId:string;onClose:()=>void}){
  const task=ini.tasks.find(t=>t.id===taskId)
  const canManage=ini.leadId===ctx.userId||ctx.isAdmin
  const [title,setTitle]=useState(task?.title??'')
  const [description,setDescription]=useState(task?.description??'')
  const [due,setDue]=useState(taskLocalDate(task?.dueAt))
  const [assigneeId,setAssigneeId]=useState(task?.assigneeId??'')
  const [status,setStatus]=useState(task?.status??'planned')
  // The editor re-serialises what it is given, so a legacy plain-text description
  // comes back as markup without anyone typing. Track a real edit instead of
  // comparing strings, or every open would claim unsaved changes.
  const [touched,setTouched]=useState(false)
  if(!task)return null
  const dirty=touched||title!==task.title||due!==taskLocalDate(task.dueAt)
    ||assigneeId!==(task.assigneeId??'')||status!==task.status
  const requestClose=()=>{if(!ctx.busy&&(!dirty||window.confirm('Discard unsaved task changes?')))onClose()}
  const members=[...new Set([ini.leadId,...ini.members])].map(id=>ctx.data.people.find(p=>p.id===id))
    .filter((p):p is Person=>!!p&&p.status==='approved')
  return <Modal titleId="task-detail-title" onRequestClose={requestClose}>
    <form className="stack" onSubmit={async e=>{e.preventDefault();if(!canManage)return
      const ok=await ctx.run('updateTask',{initiativeId:ini.id,taskId:task.id,title:title.trim(),description:description.trim(),
        dueAt:due?new Date(due).toISOString():undefined,assigneeId:assigneeId||undefined,status},'Task saved.')
      if(ok)onClose()}}>
      <div className="between"><h3 id="task-detail-title">Task details</h3>
        <button type="button" className="btn ghost sm" aria-label="Close" onClick={requestClose}><X size={16}/></button></div>
      <Field label="Title"><input autoFocus value={title} maxLength={160} disabled={!canManage||ctx.busy} onChange={e=>setTitle(e.target.value)}/></Field>
      {/* A description may hold inline images. The editor keeps the durable
          data-object-path; the adapter strips the signed src before saving, so
          nothing expiring and no base64 is persisted. */}
      <Field label="Description" hint={canManage?'Paste or upload PNG, JPEG, GIF or WebP images directly.':undefined}>
        {canManage
          ?<Editor body={description} onChange={(html)=>{setTouched(true);setDescription(html)}}
            uploadScopeId={`task:${task.id}`}
            onUploadImage={(file)=>ctx.uploadTaskImage(task.id,ini.id,file)}/>
          :<Editor body={description} readOnly/>}
      </Field>
      <Field label="Due date and time"><input type="datetime-local" value={due} disabled={!canManage||ctx.busy} onChange={e=>setDue(e.target.value)}/></Field>
      <Field label="Assigned to"><select value={assigneeId} disabled={!canManage||ctx.busy} onChange={e=>setAssigneeId(e.target.value)}>
        <option value="">Unassigned</option>{members.map(p=><option key={p.id} value={p.id}>{nameOf(p)}</option>)}
      </select></Field>
      <Field label="Status"><select value={status} disabled={ctx.busy||!(canManage||task.assigneeId===ctx.userId)} onChange={e=>setStatus(e.target.value as typeof status)}>
        <option value="planned">Planned</option><option value="pending">Pending</option><option value="finished">Finished</option>
      </select></Field>
      <div className="btn-row">
        {canManage?<button className="btn" disabled={ctx.busy||!title.trim()||!dirty}>Save changes</button>:null}
        {!canManage&&task.assigneeId===ctx.userId?<button type="button" className="btn" disabled={ctx.busy||status===task.status}
          onClick={async()=>{const ok=await ctx.run('setTaskStatus',{initiativeId:ini.id,taskId:task.id,status},'Task updated.');if(ok)onClose()}}>Save status</button>:null}
        {canManage?<button type="button" className="btn danger" disabled={ctx.busy} onClick={async()=>{
          if(window.confirm(`Delete task “${task.title}”? This cannot be undone.`)){
            const ok=await ctx.run('deleteTask',{initiativeId:ini.id,taskId:task.id},'Task deleted.');if(ok)onClose()}
        }}><Trash2 size={15}/> Delete</button>:null}
        <button type="button" className="btn ghost" disabled={ctx.busy} onClick={requestClose}>Close</button>
      </div>
    </form>
  </Modal>
}

function NewProposalForm({ ctx }: { ctx: Ctx }) {
  const editId = ctx.route.parts[1] || ''
  const existing = editId
    ? ctx.data.requests.find((r) =>
        r.id === editId && r.kind === 'proposal' && r.userId === ctx.userId)
    : undefined
  const seeded = existing ? readProposal(existing.body) : null
  const [title, setTitle] = useState(existing?.title ?? '')
  const [category, setCategory] = useState(
    seeded && CATEGORIES.includes(seeded.category) ? seeded.category : CATEGORIES[0])
  const [abstract, setAbstract] = useState(seeded?.abstract ?? '')
  const [plan, setPlan] = useState(seeded?.plan ?? '')
  const [motivation, setMotivation] = useState(seeded?.motivation ?? '')

  const send = async (status: 'draft' | 'submitted') => {
    const ok = await ctx.run(
      'createProposal',
      { id: existing?.id, title: title.trim(), category, abstract: abstract.trim(), plan: plan.trim(), motivation: motivation.trim(), status },
      status === 'draft' ? 'Draft saved.' : 'Proposal submitted for Research review.',
    )
    if (ok) go('#/proposals')
  }

  const wordCount = motivation.trim() === '' ? 0 : motivation.trim().split(/\s+/).length
  const ready = title.trim().length >= 3 && abstract.trim().length >= 20 && plan.trim().length >= 20 && wordCount >= 150
  return (
    <form className="card" onSubmit={(e: FormEvent) => { e.preventDefault(); send('submitted') }}>
      <h3>{existing ? 'Edit proposal' : 'Propose an initiative'}</h3>
      {existing?.status === 'changes_requested' && existing.feedback ? (
        <p className="field-hint"><strong>Research asked for changes:</strong> {existing.feedback}</p>
      ) : null}
      <Field label="Working title">
        <input type="text" value={title} disabled={ctx.busy} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Category">
        <select value={category} disabled={ctx.busy} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Abstract" hint="What is the question, and what would a student team actually do?">
        <textarea
          value={abstract} disabled={ctx.busy} onChange={(e) => setAbstract(e.target.value)}
          style={{ minHeight: 140 }}
        />
      </Field>
      <Field label="Execution plan" hint="Milestones, who does what, and a rough timeline for the term.">
        <textarea
          value={plan} disabled={ctx.busy} onChange={(e) => setPlan(e.target.value)}
          style={{ minHeight: 120 }}
        />
      </Field>
      <Field label="Motivation" hint={`Why is this important? (150+ words required, currently ${wordCount})`}>
        <textarea
          value={motivation} disabled={ctx.busy} onChange={(e) => setMotivation(e.target.value)}
          style={{ minHeight: 200 }}
        />
      </Field>
      <div className="btn-row">
        <button className="btn" disabled={ctx.busy || !ready}>
          <Send size={16} /> {existing ? 'Resubmit' : 'Submit proposal'}
        </button>
        <button
          type="button" className="btn ghost"
          disabled={ctx.busy || title.trim().length < 3}
          onClick={() => send('draft')}
        >
          Save draft
        </button>
        <button type="button" className="btn ghost" disabled={ctx.busy} onClick={() => go('#/proposals')}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function AssignReviewForm({ ctx, target }: { ctx: Ctx; target: DocumentRecord }) {
  const reviewedIni = ctx.data.initiatives.find((i) => i.id === target.initiativeId)
  const openReviews = ctx.data.obligations.filter((o) =>
    o.kind === 'review' && o.status !== 'complete' && o.status !== 'waived')
  // Only reviewers outside the reviewed initiative who already hold an open
  // review obligation can be pointed at this memo.
  const eligible = ctx.data.people.filter((p) =>
    p.status === 'approved' &&
    !!reviewedIni &&
    !reviewedIni.members.includes(p.id) &&
    reviewedIni.leadId !== p.id &&
    openReviews.some((o) => o.assigneeId === p.id),
  )
  const [reviewerId, setReviewerId] = useState(eligible[0]?.id ?? '')
  const [obligationId, setObligationId] = useState('')
  const [due, setDue] = useState('')

  if (!eligible.length) {
    return (
      <p className="muted">
        No reviewer outside this initiative currently holds an open review obligation.
      </p>
    )
  }
  const mine = openReviews.filter((o) => o.assigneeId === reviewerId)
  const effObl = mine.some((o) => o.id === obligationId) ? obligationId : (mine[0]?.id ?? '')
  const mustPick = mine.length > 1
  
  const baseObligation = mine.find((o) => o.id === effObl)
  const defaultDueStr = baseObligation ? formatLosAngelesLocal(new Date(baseObligation.due)) : ''

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        let parsedDue: string | undefined
        if (due) {
          try {
            parsedDue = parseLosAngelesLocal(due).toISOString()
          } catch {
            return alert('Invalid date.')
          }
        }
        await ctx.run(
          'assignReview',
          { targetId: target.id, reviewerId, obligationId: effObl, due: parsedDue },
          'Review assigned.',
        )
      }}
    >
      <div className="row">
        <Field label="Reviewer">
          <select value={reviewerId} disabled={ctx.busy}
            onChange={(e) => { setReviewerId(e.target.value); setObligationId('') }}>
            {eligible.map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
          </select>
        </Field>
        {mustPick ? (
          <Field label="Open review obligation" hint="This reviewer holds several - pick one.">
            <select value={effObl} disabled={ctx.busy}
              onChange={(e) => setObligationId(e.target.value)}>
              {mine.map((o) => (
                <option key={o.id} value={o.id}>
                  due {fmtDate(o.due)}{o.targetId ? ' - already pointed at a memo' : ' - open'}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="Due (optional)" hint="Defaults to the obligation's own deadline.">
          <input type="datetime-local" value={due || defaultDueStr} disabled={ctx.busy}
            onChange={(e) => setDue(e.target.value)} />
        </Field>
      </div>
      <div>
        <button className="btn sm" disabled={ctx.busy || !reviewerId || (mustPick && !effObl)}>
          <ClipboardList size={15} /> Assign review
        </button>
      </div>
    </form>
  )
}

function SetStatusForm({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  const [status, setStatus] = useState(ini.status)
  const [reason, setReason] = useState('')
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await ctx.run('setStatus', { initiativeId: ini.id, status, reason: reason.trim() },
          'Status updated.')
        if (ok) setReason('')
      }}
    >
      <div className="row">
        <select value={status} disabled={ctx.busy} onChange={(e) => setStatus(e.target.value)}>
          {['active', 'on_hold', 'completed', 'stopped', 'dead'].map((s) =>
            <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="text" placeholder="Reason" value={reason} disabled={ctx.busy}
          onChange={(e) => setReason(e.target.value)} />
        <button className="btn sm" disabled={ctx.busy || !reason.trim() || status === ini.status}>Apply</button>
      </div>
    </form>
  )
}

function AdjustHpForm({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await ctx.run('adjustHp',
          { initiativeId: ini.id, delta: Number(delta), reason: reason.trim() }, 'HP adjusted.')
        if (ok) { setDelta(''); setReason('') }
      }}
    >
      <div className="row">
        <input type="number" placeholder="+/- HP" value={delta} disabled={ctx.busy}
          style={{ width: 96 }} onChange={(e) => setDelta(e.target.value)} />
        <input type="text" placeholder="Reason" value={reason} disabled={ctx.busy}
          onChange={(e) => setReason(e.target.value)} />
        <button className="btn sm" disabled={ctx.busy || !reason.trim() || !Number(delta)}>Adjust</button>
      </div>
    </form>
  )
}

// --- document views ---------------------------------------------------

const SPLIT_KEY = 'openlabs:split:v1'
const readSplit = (name: string): number => {
  try {
    const value = Number(localStorage.getItem(`${SPLIT_KEY}:${name}`))
    return Number.isFinite(value) && value >= 20 && value <= 80 ? value : 50
  } catch { return 50 }
}

/**
 * Two panes with a draggable, keyboard-operable divider.
 *
 * The ratio is only a grid-template-columns value on the wrapper, so resizing
 * never changes the shape of the subtree: the draft editor keeps its instance,
 * its pending autosave timer and its in-flight uploads. Below 900px the panes
 * stack (see style.css) because a half-width column is narrower than a readable
 * line, and the divider is hidden rather than left as a dead control.
 */
function SplitPane({ name, label, left, right }: {
  name: string; label: string; left: ReactNode; right: ReactNode
}) {
  const [pct, setPct] = useState(() => readSplit(name))
  const wrap = useRef<HTMLDivElement | null>(null)
  const dragging = useRef(false)

  const store = (next: number) => {
    const clamped = Math.max(20, Math.min(80, Math.round(next)))
    setPct(clamped)
    try { localStorage.setItem(`${SPLIT_KEY}:${name}`, String(clamped)) } catch { /* ignore */ }
  }
  const fromPointer = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return
    store(((clientX - box.left) / box.width) * 100)
  }

  useEffect(() => {
    const move = (e: PointerEvent) => { if (dragging.current) fromPointer(e.clientX) }
    const up = () => { dragging.current = false }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="split" ref={wrap}
      style={{ gridTemplateColumns: `minmax(0,${pct}fr) auto minmax(0,${100 - pct}fr)` }}>
      <div className="split-pane">{left}</div>
      <div
        className="split-handle" role="separator" tabIndex={0}
        aria-orientation="vertical" aria-label={label}
        aria-valuenow={pct} aria-valuemin={20} aria-valuemax={80}
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture?.(e.pointerId) }}
        onDoubleClick={() => store(50)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); store(pct - 2) }
          else if (e.key === 'ArrowRight') { e.preventDefault(); store(pct + 2) }
          else if (e.key === 'Home') { e.preventDefault(); store(25) }
          else if (e.key === 'End') { e.preventDefault(); store(75) }
          else if (e.key === 'Enter') { e.preventDefault(); store(50) }
        }}
      />
      <div className="split-pane">{right}</div>
    </div>
  )
}

/**
 * The exact Roast Me version a review draft is accountable to. The obligation's
 * targetVersion is what Research assigned, so the reference pane shows that
 * version and not whatever the team has submitted since.
 */
function referencedVersion(ctx: Ctx, doc: DocumentRecord) {
  if (!doc.targetId) return null
  const target = ctx.data.documents.find((d) => d.id === doc.targetId)
  if (!target) return null
  const pinned = ctx.data.obligations.find((o) => o.id === doc.obligationId)?.targetVersion
  const versions = versionsOf(target)
  const version = versions.find((v) => v.version === pinned) ?? versions[versions.length - 1]
  return version ? { target, version } : null
}

function DraftEditor({ ctx, doc, ini, onWorkState, onSubmitted }: {
  ctx:Ctx; doc:DocumentRecord; ini:Initiative;
  onWorkState?:(state:{unsaved:boolean;uploads:number})=>void; onSubmitted?:()=>void
}) {
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [submittingRm, setSubmittingRm] = useState(false)
  const [submitMonday, setSubmitMonday] = useState(doc.targetMonday ?? losAngelesMonday())
  const [unsaved,setUnsaved]=useState(false)
  const [uploads,setUploads]=useState(0)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(()=>onWorkState?.({unsaved,uploads}),[unsaved,uploads,onWorkState])

  useEffect(() => {
    if (!dirty.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const ok = await ctx.run('saveDraft', { documentId: doc.id, title, body })
      if (ok) { setSavedAt(Date.now()); dirty.current = false; setUnsaved(false) }
    }, 900)
    return () => clearTimeout(timer.current)
  }, [title, body]) // eslint-disable-line react-hooks/exhaustive-deps

  const isRm = doc.kind === 'rm'
  const attached = !!doc.obligationId
  const isLead = ini.leadId === ctx.userId
  const choosingWeek = isRm && submittingRm && !attached
  const submissionWeek = attached ? doc.targetMonday : submitMonday
  const week = weekState(ctx, submissionWeek)
  // Drafting never needs a cycle. The chooser and cycle validation appear only
  // after the lead starts the submission flow.
  const blocked = isRm && (choosingWeek || attached) && week.tone !== 'good' ? week.note : ''
  const canStartSubmit = isRm ? isLead : doc.authorId === ctx.userId
  const targetSaved = attached || doc.targetMonday === submitMonday
  const canFinishSubmit = canStartSubmit && (!isRm || attached || (submittingRm && !blocked && targetSaved))

  // A review is written against one pinned Roast Me version, so that version sits
  // beside the draft rather than behind a navigation step.
  const reference = !isRm ? referencedVersion(ctx, doc) : null

  const draftBody = (
    <>
      <div className="between">
        <div>
          <Pill tone="info">draft</Pill>{' '}
          <Pill tone="muted">{isRm ? 'Roast Me' : 'manual review'}</Pill>{' '}
          {isRm && (choosingWeek || attached) ? <Pill tone={week.tone}>{week.label}</Pill> : null}
        </div>
        <span className="muted">
          {savedAt ? `saved ${fmtDateTime(new Date(savedAt).toISOString())}` : 'not saved yet'}
        </span>
      </div>
      {choosingWeek ? (
        <Field
          label="Submit for cycle week (Monday, Los Angeles)"
          hint="Choose the cycle this Roast Me should satisfy. The cycle must already be open."
        >
          <WeekSelect
            ctx={ctx} value={submitMonday} onPick={async (monday) => {
              const previous = doc.targetMonday ?? losAngelesMonday()
              setSubmitMonday(monday)
              const ok = await ctx.run('setDraftTarget',
                { documentId: doc.id, targetMonday: monday }, `Pointed at the week of ${monday}.`)
              if (!ok) setSubmitMonday(previous)
            }}
          />
        </Field>
      ) : null}
      {isRm && attached ? (
        <p className="field-hint">This revision remains attached to the cycle week of {doc.targetMonday}.</p>
      ) : null}
      {blocked ? <p className="field-hint" role="status">{blocked}</p> : null}
      <Field label="Title">
        <input
          type="text" value={title} disabled={ctx.busy}
          onChange={(e) => { dirty.current = true; setUnsaved(true); setTitle(e.target.value) }}
        />
      </Field>
      <Field label="Body" hint="Paste or upload PNG, JPEG, GIF or WebP images directly into the text.">
        <Editor
          body={body}
          onChange={(html) => { dirty.current = true; setUnsaved(true); setBody(html) }}
          uploadScopeId={doc.id}
          onUploadImage={(file) => {
            if (!doc.id) {
              alert('Please save the draft first.')
              return Promise.resolve(null)
            }
            setUploads(n=>n+1)
            return ctx.uploadRmImage(doc.id, ini.id, file).finally(()=>setUploads(n=>Math.max(0,n-1)))
          }}
        />
      </Field>
      <div className="btn-row">
        <button
          className="btn ghost sm"
          disabled={ctx.busy}
          onClick={async () => {
            const ok = await ctx.run('saveDraft', { documentId: doc.id, title, body }, 'Draft saved.')
            if (ok) { setSavedAt(Date.now()); dirty.current = false; setUnsaved(false) }
          }}
        >
          Save now
        </button>
        <button
          className="btn"
          disabled={ctx.busy || !canStartSubmit || (submittingRm && !canFinishSubmit)}
          title={blocked || (canStartSubmit ? '' : 'Only the lead submits this document')}
          onClick={async () => {
            const label = isRm ? 'Roast Me' : 'review'
            if (isRm && !attached && !submittingRm) {
              setSubmittingRm(true)
              return
            }
            if (!window.confirm(`Submit this ${label}? You can reopen it later to revise.`)) return
            clearTimeout(timer.current) // cancel any pending autosave
            dirty.current = false
            const ok=await ctx.run('submitDocument', { documentId: doc.id, title, body }, 'Submitted.')
            if(ok)onSubmitted?.()
          }}
        >
          <Send size={15} /> {isRm && !attached && !submittingRm ? 'Choose cycle & submit' : 'Submit'}
        </button>
      </div>
      {isRm && !isLead ? (
        <p className="field-hint">
          Any member of the team can draft; the initiative lead submits the team's Roast Me.
        </p>
      ) : null}
    </>
  )

  if (!reference) return <div className="card">{draftBody}</div>
  return (
    <div className="card">
      <SplitPane
        name="review" label="Resize the Roast Me and review panes"
        left={
          <section aria-label={`Roast Me under review, version ${reference.version.version}`}>
            <div className="between">
              <div>
                <strong>{reference.target.title}</strong>
                <div className="field-hint">
                  Reviewing v{reference.version.version}
                  {reference.version.at ? ` submitted ${fmtDate(reference.version.at)}` : ''}
                  {' - '}
                  {reference.target.authorName ?? ctx.personName(reference.target.authorId)}
                </div>
              </div>
              <a className="btn ghost sm" href={`#/document/${reference.target.id}`}>Open full page</a>
            </div>
            {/* Read-only and pinned: the reference never becomes editable, and it
                shows the assigned version even after a later revision. */}
            <Editor body={sanitize(reference.version.body)} readOnly />
          </section>
        }
        right={draftBody}
      />
    </div>
  )
}

/**
 * Any member of an active initiative can start a Roast Me without choosing a
 * cycle. It is provisionally kept under the current Los Angeles week until the
 * lead chooses the cycle in the submission flow.
 */
function StartRoastMe({ ctx, ini, onOpen }: { ctx: Ctx; ini: Initiative; onOpen:(id:string)=>void }) {
  const monday = losAngelesMonday()
  const [waiting,setWaiting]=useState(false)
  const existing = ctx.data.documents.find((d) =>
    d.initiativeId === ini.id && d.kind === 'rm' && !d.historical && d.targetMonday === monday)
  useEffect(()=>{if(waiting&&existing){setWaiting(false);onOpen(existing.id)}},[waiting,existing,onOpen])
  return (
    <div className="row">
      <button
        className="btn sm"
        disabled={ctx.busy || waiting || ini.status !== 'active'}
        title={ini.status !== 'active' ? 'This initiative is not active.' : ''}
        onClick={async () => {
          if (existing) { onOpen(existing.id); return }
          const ok = await ctx.run('createDraft',
            { initiativeId: ini.id, kind: 'rm' }, 'Roast Me draft started.')
          if (ok) setWaiting(true)
        }}
      >
        <Plus size={15} /> {waiting?'Opening…':existing ? 'Open this week’s Roast Me' : 'Start Roast Me'}
      </button>
    </div>
  )
}

function CommentComposer({ ctx, doc, version }: { ctx: Ctx; doc: DocumentRecord; version: number }) {
  const [quote, setQuote] = useState('')
  const [body, setBody] = useState('')
  const [open, setOpen] = useState(false)
  if (!open) {
    return (
      <button className="btn secondary sm" disabled={ctx.busy} onClick={() => setOpen(true)}>
        <MessageSquare size={15} /> Add a comment
      </button>
    )
  }
  return (
    <form
      className="stack card"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await ctx.run(
          'addThread',
          { documentId: doc.id, version, quote: quote.trim(), body: body.trim() },
          'Comment posted.',
        )
        if (ok) { setQuote(''); setBody(''); setOpen(false) }
      }}
    >
      <Field label={`Passage from v${version}`} hint="Paste the sentence or phrase you are responding to.">
        <input type="text" value={quote} disabled={ctx.busy} onChange={(e) => setQuote(e.target.value)} />
      </Field>
      <Field label="Comment">
        <textarea value={body} disabled={ctx.busy} onChange={(e) => setBody(e.target.value)} />
      </Field>
      <div className="btn-row">
        <button className="btn sm" disabled={ctx.busy || !quote.trim() || !body.trim()}>Post comment</button>
        <button type="button" className="btn ghost sm" disabled={ctx.busy}
          onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

/**
 * Inline comments on the Roast Me itself.
 *
 * The version is rendered WITH its formatting and inline images, and each
 * anchored thread is drawn over the passage it was recorded against. Exactness
 * comes from the shared contract in highlight.ts rather than from stripping the
 * markup: the canonical text and the rendered DOM are produced by the same walk,
 * and a selection is converted to offsets through that walk's index map, so no
 * quote is ever matched approximately.
 *
 * A highlight is reachable three ways, because a popover that only answers to
 * hover is unusable with a keyboard or a finger: pointer hover, keyboard focus,
 * and click or tap, which pins it open until Escape or a click elsewhere.
 */
function AnnotatedVersion({ ctx, doc, version, body, threads }: {
  ctx: Ctx; doc: DocumentRecord; version: number; body: string; threads: Thread[]
}) {
  const text = useMemo(() => textOfHtml(body), [body])
  const spans = useMemo(() => resolvableSpans(threads, text), [threads, text])
  const spanKey = useMemo(
    () => spans.map((s) => `${s.start}:${s.end}:${s.threadIds.join(',')}`).join('|'),
    [spans],
  )
  const byId = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads])
  const anchored = threads.filter((t) => t.anchorStart !== undefined)
  const dropped = anchored.length - spans.length

  const [active, setActive] = useState<{ ids: string[]; top: number; left: number } | null>(null)
  const [pinned, setPinned] = useState(false)
  const [pending, setPending] = useState<Anchor | null>(null)
  const [comment, setComment] = useState('')
  const [misaligned, setMisaligned] = useState(false)
  const content = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<TextMap | null>(null)
  const popoverId = `hl-popover-${doc.id}-${version}`

  // Render the formatted body ourselves, through the allowlist, then draw the
  // marks over its text nodes. Deliberately NOT inside the Tiptap view: that
  // view's mutation observer would fight foreign nodes.
  useEffect(() => {
    const node = content.current
    if (!node) return
    setActive(null)
    setPinned(false)
    const rendered = renderFormatted(body, node)
    if (!rendered) { mapRef.current = null; setMisaligned(true); return }
    // The canonical text and the rendered text come from the same walk, so this
    // should never differ. If it somehow does, show the content and draw nothing
    // rather than place a highlight on words it does not belong to.
    if (rendered.text !== text) { mapRef.current = rendered; setMisaligned(true); return }
    setMisaligned(false)
    applyHighlights(spans, rendered)
    mapRef.current = mapRenderedText(node)
  }, [body, text, spanKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // aria-expanded / aria-describedby live on DOM-created marks, so they are set
  // where the active mark is known.
  useEffect(() => {
    const node = content.current
    if (!node) return
    node.querySelectorAll('mark.hl').forEach((mark) => {
      mark.classList.remove('open')
      mark.setAttribute('aria-expanded', 'false')
      mark.removeAttribute('aria-describedby')
    })
    if (!active) return
    node.querySelectorAll('mark.hl').forEach((mark) => {
      const ids = (mark.getAttribute('data-threads') ?? '').split(' ').filter(Boolean)
      if (!ids.some((id) => active.ids.includes(id))) return
      mark.classList.add('open')
      mark.setAttribute('aria-expanded', 'true')
      mark.setAttribute('aria-describedby', popoverId)
    })
  }, [active, popoverId])

  const close = () => { setActive(null); setPinned(false) }
  const markAt = (target: EventTarget | null): HTMLElement | null => {
    const element = target as Element | null
    return element && 'closest' in element
      ? (element.closest('mark.hl') as HTMLElement | null)
      : null
  }
  const show = (mark: HTMLElement) => {
    const ids = (mark.getAttribute('data-threads') ?? '').split(' ').filter(Boolean)
    if (!ids.length) return
    setActive({ ids, top: mark.offsetTop + mark.offsetHeight, left: mark.offsetLeft })
  }
  const readSelection = () => {
    const node = content.current
    const map = mapRef.current
    if (!node || !map) return
    const anchor = selectionAnchor(node, map)
    if (!anchor || anchorError(anchor, map.text)) { setPending(null); return }
    setPending(anchor)
  }

  return (
    <div
      className="annotated"
      onKeyDown={(e) => { if (e.key === 'Escape') { close(); setPending(null) } }}
    >
      {/* Delegated handlers: the marks are DOM nodes, so one listener per event
          on the wrapper serves them all and keeps React owning the popover. */}
      <div
        className="annotated-content" ref={content}
        onMouseUp={readSelection} onKeyUp={readSelection}
        onMouseOver={(e) => { const m = markAt(e.target); if (m && !pinned) show(m) }}
        onMouseOut={() => { if (!pinned) setActive(null) }}
        onFocus={(e) => { const m = markAt(e.target); if (m) show(m) }}
        onBlur={() => { if (!pinned) setActive(null) }}
        onClick={(e) => {
          const m = markAt(e.target)
          if (!m) { close(); return }
          if (pinned && active) { close(); return }
          show(m); setPinned(true)
        }}
        onKeyDownCapture={(e) => {
          const m = markAt(e.target)
          if (!m || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          if (pinned && active) { close(); return }
          show(m); setPinned(true)
        }}
      />
      {active ? (
        <div className="hl-popover" id={popoverId} role="note"
          style={{ top: active.top, left: active.left }}>
          {active.ids.map((id) => {
            const thread = byId.get(id)
            if (!thread) return null
            return (
              <div className="hl-popover-thread" key={id}>
                <strong>{ctx.personName(thread.messages[0]?.authorId ?? '')}</strong>
                <span>{thread.messages[0]?.body ?? ''}</span>
                {thread.messages.length > 1
                  ? <em>{thread.messages.length - 1} more repl{thread.messages.length === 2 ? 'y' : 'ies'} below</em>
                  : null}
                {thread.resolved ? <em>resolved</em> : null}
              </div>
            )
          })}
        </div>
      ) : null}
      {misaligned ? (
        <p className="field-hint" role="status">
          This version is shown without highlights because its text could not be
          measured here. Existing comments are listed below.
        </p>
      ) : null}

      {ctx.approved && pending ? (
        <form
          className="stack card" style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault()
            const ok = await ctx.run('addThread', {
              documentId: doc.id, version, quote: pending.quote,
              anchorStart: pending.start, anchorEnd: pending.end, body: comment.trim(),
            }, 'Comment posted on the selected passage.')
            if (ok) { setPending(null); setComment('') }
          }}
        >
          <Field label={`Selected passage in v${version}`}>
            <blockquote className="quote">{pending.quote}</blockquote>
          </Field>
          <Field label="Comment">
            <textarea autoFocus value={comment} disabled={ctx.busy}
              onChange={(e) => setComment(e.target.value)} />
          </Field>
          <div className="btn-row">
            <button className="btn sm" disabled={ctx.busy || !comment.trim()}>Comment on selection</button>
            <button type="button" className="btn ghost sm" disabled={ctx.busy}
              onClick={() => { setPending(null); setComment('') }}>Cancel</button>
          </div>
        </form>
      ) : null}
      {ctx.approved && !pending ? (
        <p className="field-hint" style={{ marginTop: 8 }}>
          Select any passage above to comment on it. Highlights show where existing
          comments point; hover, tab to one, or tap it to read.
        </p>
      ) : null}
      {dropped > 0 ? (
        <p className="field-hint">
          {dropped} comment{dropped === 1 ? '' : 's'} on this version point at text
          that has since changed, so {dropped === 1 ? 'it is' : 'they are'} listed
          below without a highlight rather than marked over different words.
        </p>
      ) : null}
    </div>
  )
}

function ThreadCard({ ctx, thread }: { ctx: Ctx; thread: Thread }) {
  const [reply, setReply] = useState('')
  return (
    <div className={`thread ${thread.resolved ? 'resolved' : ''}`}>
      <div className="between">
        <div className="quote">&ldquo;{thread.quote}&rdquo;</div>
        <Pill tone={thread.resolved ? 'good' : 'warn'}>{thread.resolved ? 'resolved' : 'open'}</Pill>
      </div>
      {thread.messages.map((m, idx) => (
        <div className="msg" key={idx}>
          <div className="msg-meta">
            <strong>{ctx.personName(m.authorId)}</strong>
            <span>{fmtDateTime(m.at)}</span>
          </div>
          <div>{m.body}</div>
        </div>
      ))}
      {ctx.approved ? (
        <div className="stack" style={{ marginTop: 10 }}>
          {!thread.resolved ? (
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault()
                const ok = await ctx.run('replyThread', { threadId: thread.id, body: reply.trim() })
                if (ok) setReply('')
              }}
            >
              <input type="text" placeholder="Reply" value={reply} disabled={ctx.busy}
                onChange={(e) => setReply(e.target.value)} />
              <button className="btn sm" disabled={ctx.busy || !reply.trim()}>Reply</button>
            </form>
          ) : null}
          <button
            className="btn ghost sm"
            disabled={ctx.busy}
            onClick={() => ctx.run('resolveThread', { threadId: thread.id, resolved: !thread.resolved })}
          >
            {thread.resolved ? 'Re-open thread' : 'Resolve thread'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SubmittedDoc({ ctx, doc, ini }: { ctx: Ctx; doc: DocumentRecord; ini: Initiative }) {
  const versions = versionsOf(doc)
  const [ver, setVer] = useState(versions[versions.length - 1]?.version ?? doc.version)
  const shown = versions.find((v) => v.version === ver) ?? versions[versions.length - 1]
  const threads = ctx.data.threads
    .filter((t) => t.documentId === doc.id && t.version === (shown?.version ?? doc.version))
  const anchoredCount = threads.filter((t) => t.anchorStart !== undefined).length
  const [annotated, setAnnotated] = useState(false)
  const target = doc.targetId ? ctx.data.documents.find((x) => x.id === doc.targetId) : null
  const canRevise = !doc.historical && (doc.kind === 'rm'
    ? ini.leadId === ctx.userId
    : doc.authorId === ctx.userId)

  return (
    <div>
      <div className="card">
        <div className="between">
          <div>
            <h3 style={{ marginBottom: 4 }}>{doc.title}</h3>
            <div className="row">
              <Pill tone="muted">{doc.kind === 'rm' ? 'Roast Me' : 'manual review'}</Pill>
              {doc.historical ? <Pill tone="info">historical record</Pill> : null}
              <Pill tone={statusTone(doc.status)}>{doc.status}</Pill>
              <span className="muted">by {doc.authorName ?? ctx.personName(doc.authorId)}</span>
              <span className="muted">{doc.submittedAt ? fmtDateTime(doc.submittedAt) : doc.sourceWeek ? `Week: ${doc.sourceWeek}` : doc.sourcePeriod || 'Date unavailable'}</span>
            </div>
            {target ? (
              <p className="muted" style={{ marginTop: 6 }}>
                Reviewing <a href={`#/document/${target.id}`}>{target.title}</a>
              </p>
            ) : null}
            {doc.historical ? <p className="muted" style={{ marginTop: 6 }}>Imported historical record — {doc.sourceWeek ?? doc.sourcePeriod ?? 'Date unavailable'}. {ctx.isResearch ? 'Research may revise if needed.' : 'It is preserved as submitted and cannot be revised by the author.'}</p> : null}
          </div>
          {versions.length > 1 ? (
            <Field label="Version">
              <select value={ver} onChange={(e) => setVer(Number(e.target.value))}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>v{v.version} - {fmtDate(v.at)}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        {/* Both modes show the same formatted version. Reading is the plain
            read-only editor; commenting adds the highlight layer and selection
            handling over our own allowlisted rendering of the same content. */}
        <div className="tabs" style={{ marginTop: 8 }}>
          <button type="button" className={`tab ${annotated ? '' : 'active'}`}
            aria-pressed={!annotated} onClick={() => setAnnotated(false)}>Reading</button>
          <button type="button" className={`tab ${annotated ? 'active' : ''}`}
            aria-pressed={annotated} onClick={() => setAnnotated(true)}>
            Inline comments{anchoredCount ? ` (${anchoredCount})` : ''}
          </button>
        </div>
        {annotated
          ? <AnnotatedVersion ctx={ctx} doc={doc} version={shown?.version ?? doc.version}
              body={sanitize(shown?.body ?? doc.body)} threads={threads} />
          : <Editor body={sanitize(shown?.body ?? doc.body)} readOnly />}
        {canRevise ? (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              className="btn ghost sm"
              disabled={ctx.busy}
              onClick={async () => {
                if (!window.confirm(
                  'Reopen this document for revision? A new version is recorded when you resubmit, ' +
                  'and it does not earn HP again.')) return
                await ctx.run('reviseDocument', { documentId: doc.id }, 'Reopened for revision.')
              }}
            >
              Revise
            </button>
          </div>
        ) : null}
        {(ctx.isResearch && doc.kind === 'rm') ? (
          // Keyed so moving to another memo discards the open form outright
          // rather than re-pointing it at a document it was not seeded from.
          <ResearchReviseRmForm key={doc.id} ctx={ctx} doc={doc} />
        ) : null}
      </div>

      <div className="section" style={{ marginTop: 20 }}>
        <div className="between">
          <h2>Comments on v{shown?.version ?? doc.version}</h2>
          {ctx.approved ? (
            <CommentComposer ctx={ctx} doc={doc} version={shown?.version ?? doc.version} />
          ) : null}
        </div>
        {threads.length
          ? threads.map((t) => <ThreadCard key={t.id} ctx={ctx} thread={t} />)
          : <Empty>No comments anchored to this version yet.</Empty>}
      </div>

      <p className="muted">
        <a href={`#/initiative/${ini.id}/documents`}><ArrowLeft size={13} /> Back to {ini.title}</a>
      </p>
    </div>
  )
}

/**
 * Research revision of a Roast Me.
 *
 * Everything the revision will send is captured in ONE snapshot taken when the
 * form opens: the document it belongs to, the version token, and the author /
 * title / body it was seeded from. Nothing in here ever re-reads `doc` for a
 * value it is going to submit, because `doc` is replaced by the 30s background
 * refresh while the form sits open. Reading the refreshed version token at
 * submit time would silently satisfy the optimistic-concurrency check in
 * revise_rm and overwrite a version this editor never saw.
 *
 * `version` is the highest EXISTING version number, which is what revise_rm
 * compares against - not documents.submitted_version_number, which a historical
 * memo deliberately keeps at 1.
 */
type ReviseDraft = {
  docId: string
  version: number
  title: string
  body: string
  reason: string
  authorId: string
  sourceAuthor: string
}

function ResearchReviseRmForm({ ctx, doc }: { ctx: Ctx; doc: DocumentRecord }) {
  const [draft, setDraft] = useState<ReviseDraft | null>(null)
  const allVersions = versionsOf(doc)
  const lastVersion = allVersions[allVersions.length - 1] || { version: doc.version, body: doc.body }

  // A snapshot only remains usable while it still describes the document on
  // screen at the version it was taken from.
  const stale = !!draft && (draft.docId !== doc.id || draft.version !== lastVersion.version)
  const patch = (fields: Partial<ReviseDraft>) => setDraft((d) => (d ? { ...d, ...fields } : d))

  if (!draft) {
    return (
      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn sm ghost" onClick={() => setDraft({
          docId: doc.id,
          version: lastVersion.version,
          title: doc.title,
          body: lastVersion.body,
          reason: '',
          authorId: doc.authorId,
          sourceAuthor: doc.authorName || '',
        })}>Research Revise RM</button>
      </div>
    )
  }

  const { version: expectedVersion, title, body, reason, authorId, sourceAuthor } = draft
  const conflict = stale
  const close = () => setDraft(null)

  return (
    <div className="card" style={{ marginTop: 12, border: '1px solid #f87171' }}>
      <div className="between">
        <h4 style={{ color: '#dc2626' }}>Research Revise RM</h4>
        <Pill tone="warn">Research Only</Pill>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Directly revise this RM (including historical ones) without returning it to the author. Expected version: {expectedVersion}.
      </p>
      {conflict ? (
        <p style={{ color: '#dc2626', marginBottom: 16, fontWeight: 'bold' }}>
          {draft.docId !== doc.id
            ? 'This form belongs to another memo. Cancel and reopen it here.'
            : `Conflict! A newer version (v${lastVersion.version}) was submitted. Please cancel and review.`}
        </p>
      ) : null}

      <div className="stack">
        <Field label="Title">
           <input type="text" value={title} onChange={e => patch({ title: e.target.value })} disabled={ctx.busy || conflict} />
        </Field>

        {doc.historical ? (
          <Field label="Source Author (Historical)">
             <input type="text" value={sourceAuthor} onChange={e => patch({ sourceAuthor: e.target.value })} disabled={ctx.busy || conflict} />
          </Field>
        ) : (
          <Field label="Author">
             <select value={authorId} onChange={e => patch({ authorId: e.target.value })} disabled={ctx.busy || conflict}>
               {ctx.data.people.filter(p => p.status === 'approved').map(p => (
                 <option key={p.id} value={p.id}>{nameOf(p)}</option>
               ))}
             </select>
          </Field>
        )}

        <Field label="Body" hint="Paste or upload PNG, JPEG, GIF or WebP images directly into the text.">
          {/* Scoped to the snapshot's document, so an upload that finishes after
              the form moved on is discarded rather than inserted here. */}
          <Editor body={body} onChange={(html) => patch({ body: html })} readOnly={conflict}
            uploadScopeId={draft.docId}
            onUploadImage={(file) => ctx.uploadRmImage(draft.docId, doc.initiativeId, file)} />
        </Field>

        <Field label="Revision Reason (Required)">
          <input type="text" value={reason} onChange={e => patch({ reason: e.target.value })} disabled={ctx.busy || conflict} placeholder="Why is Research revising this RM?" />
        </Field>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn sm" disabled={ctx.busy || conflict || !reason.trim()} onClick={async () => {
            // Submitted straight from the snapshot: the document id and the
            // version token are the ones this editor actually saw.
            if (stale) return
            const ok = await ctx.run('reviseRm', {
              documentId: draft.docId,
              title,
              body,
              reason: reason.trim(),
              authorId: doc.historical ? undefined : authorId,
              sourceAuthor: doc.historical ? sourceAuthor : undefined,
              expectedVersion
            }, 'RM Revised.')
            if (ok) close()
          }}>Submit Revision</button>
          <button className="btn sm ghost" disabled={ctx.busy} onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// --- pages ----------------------------------------------------------

function AccessNeeded({ ctx }: { ctx: Ctx }) {
  return (
    <div className="card">
      <h3>An approved account is needed here</h3>
      <p className="muted">
        {ctx.me
          ? `Your account is ${ctx.me.status}. Operations or Research approval unlocks the internal workspace.`
          : 'Sign in and wait for Operations or Research to approve your account.'}
      </p>
      <a className="btn ghost" href="#/catalog">Browse the public catalog</a>
    </div>
  )
}

function NotFound() {
  return (
    <div className="card">
      <h3>Nothing here</h3>
      <p className="muted">That page does not exist.</p>
      <a className="btn ghost" href="#/">Go home</a>
    </div>
  )
}

function AuthLinkError({ expired, signedIn }: { expired: boolean; signedIn: boolean }) {
  return (
    <div className="card">
      <h1>{expired ? 'This sign-in link has already been used or expired' : 'This sign-in link could not be used'}</h1>
      <p className="muted">
        {signedIn
          ? 'Your account is already signed in. Open the workspace to continue.'
          : 'Email links work only once. Request a new sign-in email. If it includes a six-digit code, you can enter the code instead.'}
      </p>
      <div className="btn-row">
        <a className="btn" href={signedIn ? '#/' : '#/signin'}>{signedIn ? 'Open workspace' : 'Request a new sign-in email'}</a>
        <a className="btn ghost" href="#/">Go home</a>
      </div>
    </div>
  )
}

function EmailLinkConfirm({ ctx }: { ctx: Ctx }) {
  const tokenHash = ctx.route.parts[1] ?? ''
  if (!/^(?:pkce_)?[a-f0-9]{56}$/i.test(tokenHash) || !ctx.onVerifyLink) {
    return <AuthLinkError expired={false} signedIn={!!ctx.me} />
  }
  if (ctx.me) {
    return <div className="card"><h1>You are signed in</h1><a className="btn" href="#/">Open workspace</a></div>
  }
  return (
    <div className="card">
      <h1>Finish signing in</h1>
      <p className="muted">Press the button to use the sign-in email you just opened.</p>
      <button className="btn" disabled={ctx.busy} onClick={async () => {
        if (!await ctx.onVerifyLink?.(tokenHash)) return
        window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + '#/')
        window.dispatchEvent(new Event('hashchange'))
      }}>Sign in to The External Brain</button>
    </div>
  )
}

function PageSignIn({ ctx }: { ctx: Ctx }) {
  if (ctx.me) {
    return (
      <div className="card">
        <h3>You are signed in</h3>
        <p className="muted">Your name, major and research interests live on your profile.</p>
        <a className="btn" href="#/settings"><IdCard size={16} /> Open Settings</a>
      </div>
    )
  }
  return (
    <div>
      <div className="section">
        <h1>Sign in to The External Brain</h1>
        <p className="muted">
          Decoded Brain at UC San Diego. Members sign in through email - there is
          no password to remember.
        </p>
      </div>
      <SignInPanel ctx={ctx} />
    </div>
  )
}

function PageSettings({
  ctx, dark, onToggleDark, actualRoles, previewing, previewRoles, setPreviewRoles,
}: {
  ctx: Ctx
  dark: boolean
  onToggleDark: () => void
  actualRoles: string[]
  previewing: boolean
  previewRoles: string[] | null
  setPreviewRoles: (roles: string[] | null) => void
}) {
  const me = ctx.me
  if (!me) {
    return (
      <div>
        <div className="section">
          <h1>Settings</h1>
          <p className="muted">Choose your appearance or sign in to manage your account.</p>
        </div>
        <div className="card">
          <h3>Appearance</h3>
          <p className="muted">Use the appearance that is most comfortable for you.</p>
          <button type="button" className="btn ghost" aria-pressed={dark} onClick={onToggleDark}>
            {dark ? <Sun size={16} /> : <Moon size={16} />} Use {dark ? 'light' : 'dark'} appearance
          </button>
        </div>
        <div className="card">
          <h3>Account</h3>
          {ctx.mode === 'demo' ? (
            <Field label="View the demo as">
              <select
                value={ctx.userId ?? ''}
                disabled={ctx.busy}
                onChange={(e) => ctx.run('switchDemoUser', { userId: e.target.value || null })}
              >
                <option value="">Signed-out visitor</option>
                {[...ctx.data.people].sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map((p) => (
                  <option key={p.id} value={p.id}>
                    {nameOf(p)} - {accountRoleBadges(p).map((b) => b.label).join(', ')}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <p className="muted">Sign in to update your personal details and access the workspace.</p>
              <a className="btn" href="#/signin"><LogIn size={16} /> Sign in</a>
            </>
          )}
        </div>
      </div>
    )
  }
  const email = ctx.authEmail || me.email
  const people = [...ctx.data.people].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  return (
    <div>
      <div className="section">
        <h1>Settings</h1>
        <p className="muted">Manage your profile, appearance and account.</p>
      </div>

      <div className="card">
        <h2>Your profile</h2>
        <div className="row">
          <strong>{nameOf(me)}</strong>
          {/* The same single, deduplicated badge set the header shows. */}
          {accountRoleBadges(me).map(({ label, tone }) => (
            <Pill key={label} tone={tone}>{label}</Pill>
          ))}
        </div>
        <p className="field-hint" style={{ marginTop: 10 }}>
          {email ? <>Signed in as <strong>{email}</strong>. </> : null}
          Your email, your account status and any roles are not editable here - Operations
          or Research decide those.
        </p>
        {me.status === 'pending' ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Your account is still pending. Keep these details up to date while Operations
            or Research review it - they are what your reviewer reads.
          </p>
        ) : null}
      </div>

      {/* Keyed on the account so the form never carries one member's draft edits
          into another member's session on the same browser. */}
      <ProfileForm key={me.id} ctx={ctx} me={me} />

      <div className="card">
        <h3>Appearance</h3>
        <p className="muted">Use the appearance that is most comfortable for you.</p>
        <button type="button" className="btn ghost" aria-pressed={dark} onClick={onToggleDark}>
          {dark ? <Sun size={16} /> : <Moon size={16} />} Use {dark ? 'light' : 'dark'} appearance
        </button>
      </div>

      <div className="card">
        <h3>Account</h3>
        <p className="field-hint">
          Signed in as <strong>{email || 'your account'}</strong>. Account status and roles are managed by Operations or Research.
        </p>
        {ctx.mode === 'demo' ? (
          <Field label="View the demo as">
            <select
              value={ctx.userId ?? ''}
              disabled={ctx.busy}
              onChange={(e) => ctx.run('switchDemoUser', { userId: e.target.value || null })}
            >
              <option value="">Signed-out visitor</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf(p)} - {accountRoleBadges(p).map((b) => b.label).join(', ')}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <button className="btn danger" disabled={ctx.busy} onClick={() => ctx.onSignOut()}>
            <LogOut size={16} /> Sign out
          </button>
        )}
      </div>

      {ctx.approved && actualRoles.length > 0 ? (
        <div className="card">
          <h3>Role preview</h3>
          {previewing ? (
            <>
              <p className="muted">
                You are viewing The External Brain as {previewRoles!.length ? previewRoles!.join(' + ') : 'an ordinary Member'}.
              </p>
              <button className="btn ghost" disabled={ctx.busy} onClick={() => setPreviewRoles(null)}>Exit preview</button>
            </>
          ) : (
            <>
              <p className="muted">
                See the app as a narrower role. This is read-only and does not change your access.
              </p>
              <div className="btn-row">
                <button className="btn ghost sm" disabled={ctx.busy} onClick={() => setPreviewRoles([])}>
                  View as a Member
                </button>
                {actualRoles.filter((r) => r !== 'admin').map((role) => (
                  <button key={role} className="btn ghost sm" disabled={ctx.busy} onClick={() => setPreviewRoles([role])}>
                    View as {role} only
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function InitiativeCard({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  let hash = 0
  for (let i = 0; i < ini.id.length; i++) hash = ini.id.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  
  const bg = ini.coverUrl 
    ? `url(${ini.coverUrl}) ${ini.coverPositionX??50}% ${ini.coverPositionY??50}%/cover no-repeat`
    : (ini.coverFallbackColor || `hsl(${hue}, 65%, 85%)`)

  return (
    <a className="card" href={`#/initiative/${ini.id}/overview`} style={{ display: 'block', overflow: 'hidden' }}>
      <div style={{
        margin: '-20px -20px 20px -20px',
        height: '140px',
        background: bg
      }} />
      <div className="between">
        <h3 style={{ marginBottom: 4 }}>{ini.title}</h3>
        <Pill tone={statusTone(ini.status)}>{ini.status}</Pill>
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <Pill>{ini.category}</Pill>
        <span className="muted">{ini.members.length} member{ini.members.length === 1 ? '' : 's'}</span>
      </div>
      <p className="clamp3 muted">{ini.abstract}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="muted">Lead: {ctx.personName(ini.leadId)}</span>
        {ctx.approved ? <HpBar hp={ini.hp} /> : null}
      </div>
    </a>
  )
}

function CatalogCard({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  let hash = 0
  for (let i = 0; i < ini.id.length; i++) hash = ini.id.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  const variant = Math.abs(hash) % 2

  const bg = ini.coverUrl
    ? {
        backgroundImage: `url(${ini.coverUrl})`,
        backgroundPosition: `${ini.coverPositionX ?? 50}% ${ini.coverPositionY ?? 50}%`,
        backgroundSize: 'cover',
      }
    : { backgroundColor: ini.coverFallbackColor || `hsl(${hue}, 28%, 18%)` }

  return (
    <a className="catalog-card" href={`#/initiative/${ini.id}/overview`}>
      <div className="catalog-media-frame">
        <div className="catalog-media-art" style={bg}>
          {!ini.coverUrl && (
            variant === 0 ? (
              <svg className="catalog-svg" viewBox="0 0 300 150" fill="none" aria-hidden="true">
                <path d="M0 75 Q37.5 25 75 75 T150 75 T225 75 T300 75" stroke="currentColor" strokeWidth="2" opacity="0.45" />
                <path d="M0 90 C45 130 85 35 150 85 S240 45 300 80" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
              </svg>
            ) : (
              <svg className="catalog-svg" viewBox="0 0 300 150" fill="none" aria-hidden="true">
                <path d="M0 85 L70 85 85 95 100 25 115 115 130 80 145 85 210 85 225 40 240 100 255 85 300 85" stroke="currentColor" strokeWidth="2" opacity="0.45" />
                <path d="M0 105 L120 105 135 65 150 120 165 105 300 105" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
              </svg>
            )
          )}
          <div className="catalog-badges">
            <span className="catalog-category-tag">{ini.category}</span>
            <Pill tone={statusTone(ini.status)}>{ini.status}</Pill>
          </div>
        </div>
        <div className="catalog-overlay">
          <p className="catalog-overlay-abstract">{ini.abstract}</p>
          <div className="catalog-overlay-meta">
            <span>Lead: {ctx.personName(ini.leadId)}</span>
            <span>{ini.members.length} {ini.members.length === 1 ? 'member' : 'members'}</span>
          </div>
        </div>
      </div>
      <div className="catalog-card-bottom">
        <h3 className="catalog-card-title">{ini.title}</h3>
      </div>
    </a>
  )
}

function PageCatalog({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState('asc')

  const allowed = useMemo(() => {
    return ctx.approved ? ctx.data.initiatives : ctx.data.initiatives.filter((i) => i.status === 'active')
  }, [ctx.data.initiatives, ctx.approved])

  const categoryList = useMemo(() => {
    const counts = new Map<string, number>()
    for (const i of allowed) {
      if (i.category) counts.set(i.category, (counts.get(i.category) || 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [allowed])

  const list = useMemo(() => {
    const query = q.trim().toLowerCase()
    return allowed
      .filter((i) => {
        if (ctx.approved && activeOnly && i.status !== 'active') return false
        if (category !== 'All' && i.category !== category) return false
        if (!query) return true
        const lead = ctx.personName(i.leadId) || ''
        return `${i.title} ${i.category} ${i.abstract} ${lead}`.toLowerCase().includes(query)
      })
      .sort((a, b) => {
        const cmp = a.title.localeCompare(b.title)
        return sort === 'desc' ? -cmp : cmp
      })
  }, [allowed, ctx, q, activeOnly, category, sort])

  return (
    <div className="catalog-page">
      <div className="section">
        <h1>Research catalog</h1>
        <p className="muted">
          Every active Decoded Brain initiative at UC San Diego. Anyone can read this page.
        </p>
      </div>
      <div className="catalog-toolbar">
        <div className="catalog-toolbar-main">
          <input
            type="search"
            className="catalog-search"
            placeholder="Search initiatives"
            aria-label="Search initiatives"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="catalog-toolbar-actions">
            {ctx.approved ? (
              <label className="catalog-filter-label">
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => setActiveOnly(e.target.checked)}
                />
                Active only
              </label>
            ) : null}
            <label className="catalog-filter-label">
              <select
                className="catalog-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort initiatives"
              >
                <option value="asc">Name A-Z</option>
                <option value="desc">Name Z-A</option>
              </select>
            </label>
          </div>
        </div>
        <div className="catalog-chips" role="group" aria-label="Discipline filter">
          <button
            type="button"
            className={`catalog-chip ${category === 'All' ? 'is-active' : ''}`}
            aria-pressed={category === 'All'}
            onClick={() => setCategory('All')}
          >
            All disciplines ({allowed.length})
          </button>
          {categoryList.map(([cat, count]) => (
            <button
              type="button"
              key={cat}
              className={`catalog-chip ${category === cat ? 'is-active' : ''}`}
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat} ({count})
            </button>
          ))}
        </div>
      </div>
      <div className="catalog-results-header">
        <span className="catalog-count muted">
          {list.length} {list.length === 1 ? 'initiative' : 'initiatives'} found
        </span>
      </div>
      {list.length ? (
        <div className="catalog-grid">
          {list.map((i) => (
            <CatalogCard key={i.id} ctx={ctx} ini={i} />
          ))}
        </div>
      ) : (
        <Empty>No initiatives match.</Empty>
      )}
    </div>
  )
}

function ObligationRow({ ctx, ob }: { ctx: Ctx; ob: Obligation }) {
  const ini = ctx.data.initiatives.find((i) => i.id === ob.initiativeId)
  const targetDoc = ob.targetId ? ctx.data.documents.find((d) => d.id === ob.targetId) : null
  const reviewedIni = targetDoc ? ctx.data.initiatives.find((i) => i.id === targetDoc.initiativeId) : null
  // The obligation's deadline sits inside the week it belongs to, so its LA
  // Monday is the week a draft has to be pointed at to satisfy it.
  const week = losAngelesMonday(new Date(ob.due))
  const draft = ctx.data.documents.find((d) =>
    d.status === 'draft' && d.kind === ob.kind &&
    (ob.kind === 'rm'
      // A Roast Me draft belongs to the whole team, whoever started it.
      ? d.initiativeId === ob.initiativeId && (d.targetMonday ?? week) === week
      : d.targetId === ob.targetId && d.authorId === ctx.userId),
  )
  const submitted = ctx.data.documents.find((d) =>
    d.status !== 'draft' && d.kind === ob.kind &&
    (ob.kind === 'rm' ? d.initiativeId === ob.initiativeId : d.targetId === ob.targetId) &&
    (ob.kind === 'rm' ? true : d.authorId === ctx.userId),
  )
  const overdue = relDue(ob.due).includes('overdue')
  return (
    <div className="thread">
      <div className="between">
        <div>
          <strong>
            {ob.kind === 'rm'
              ? `Roast Me - ${ini?.title ?? 'initiative'}`
              : `Review of ${targetDoc?.title ?? 'a memo'}${reviewedIni ? ` (${reviewedIni.title})` : ''}`}
          </strong>
          <div className="msg-meta">
            <Pill tone={statusTone(ob.status)}>{ob.status}</Pill>
            <span className={overdue ? 'pill bad' : ''}>{relDue(ob.due)}</span>
          </div>
        </div>
        <div className="btn-row">
          {submitted ? (
            <a className="btn ghost sm" href={`#/document/${submitted.id}`}><CheckCheck size={15} /> Submitted</a>
          ) : draft ? (
            <a className="btn sm" href={`#/document/${draft.id}`}>Open draft</a>
          ) : (
            <button
              className="btn sm"
              disabled={ctx.busy}
              onClick={async () => {
                const ok = ob.kind === 'rm'
                  ? await ctx.run('createDraft',
                    { initiativeId: ob.initiativeId, kind: 'rm', targetMonday: week }, 'Draft started.')
                  : await ctx.run('createDraft',
                    { initiativeId: reviewedIni?.id, kind: 'review', targetId: ob.targetId }, 'Draft started.')
                if (ok && ini) {
                  go(ob.kind === 'rm'
                    ? `#/initiative/${ob.initiativeId}/documents`
                    : `#/initiative/${reviewedIni?.id ?? ob.initiativeId}/documents`)
                }
              }}
            >
              Start draft
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PageHome({ ctx }: { ctx: Ctx }) {
  const { data, me, userId } = ctx

  if (!me) {
    const featured = data.initiatives.filter((i) => i.status === 'active').slice(0, 6)
    return (
      <div>
        <div className="hero">
          <h1>A shared workspace for student research.</h1>
          <p className="muted" style={{ maxWidth: '52ch' }}>
            The External Brain is where Decoded Brain initiatives at UC San Diego publish their
            work, run weekly reporting, and give each other structured feedback.
          </p>
        </div>
        <div className="card-grid section">
          <SignInPanel ctx={ctx} />
        </div>
        <h2>Active initiatives</h2>
        <div className="card-grid">
          {featured.map((i) => <InitiativeCard key={i.id} ctx={ctx} ini={i} />)}
        </div>
      </div>
    )
  }

  if (!ctx.approved) {
    const mineReq = data.requests.filter((r) => r.userId === userId)
    return (
      <div>
        <div className="card">
          <h1 style={{ marginBottom: 8 }}>
            {me.status === 'pending' && 'Your account is pending approval'}
            {me.status === 'rejected' && 'Your account was not approved'}
            {me.status === 'suspended' && 'Your account is suspended'}
          </h1>
          <p className="muted">
            {me.status === 'pending'
              ? 'Operations or Research will review your request. Until then you can read the public catalog.'
              : 'Contact Operations or Research if you think this is a mistake. You can still read the public catalog.'}
          </p>
          <a className="btn" href="#/catalog"><FlaskConical size={16} /> Open the catalog</a>
        </div>
        <div className="section" style={{ marginTop: 20 }}>
          <ProfileNudge ctx={ctx} />
        </div>
        {mineReq.length ? (
          <div className="section" style={{ marginTop: 20 }}>
            <h2>Your requests</h2>
            {mineReq.map((r) => (
              <div className="card" key={r.id}>
                <div className="between">
                  <strong>{r.title}</strong>
                  <Pill tone={statusTone(r.status)}>{r.status}</Pill>
                </div>
                {r.feedback ? <p className="muted">{r.feedback}</p> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const myObligations = data.obligations.filter((o) =>
    o.assigneeId === userId && (o.status === 'pending' || o.status === 'missed'))
  const myRm = myObligations.filter((o) => o.kind === 'rm')
  const myReviews = myObligations.filter((o) => o.kind === 'review')
  const myInitiatives = initiativesFor(data, userId)
  const ledIds = myInitiatives.filter((i) => i.leadId === userId).map((i) => i.id)

  const pendingProposals = data.requests.filter((r) => r.kind === 'proposal' && r.status === 'submitted')
  const pendingJoins = data.requests.filter((r) =>
    r.kind === 'join' && r.status === 'pending' &&
    (ctx.isAdmin || ledIds.includes(r.initiativeId ?? '')))
  const pendingAccounts = data.people.filter((p) => p.status === 'pending')
  const unreviewedRm = data.documents.filter((d) =>
    !d.historical && d.kind === 'rm' && d.status === 'submitted' &&
    !data.obligations.some((o) => o.kind === 'review' && o.targetId === d.id))
  const openThreads = data.threads.filter((t) => {
    if (t.resolved) return false
    const doc = data.documents.find((x) => x.id === t.documentId)
    return !!doc && myInitiatives.some((i) => i.id === doc.initiativeId)
  })

  const decisions: ReactNode[] = []
  if (ctx.isResearch && pendingProposals.length) {
    decisions.push(<li key="p"><a href="#/proposals">{pendingProposals.length} proposal(s) awaiting review</a></li>)
  }
  if (pendingJoins.length) {
    decisions.push(<li key="j"><a href="#/requests">{pendingJoins.length} join request(s) to decide</a></li>)
  }
  if (ctx.isAdmin && pendingAccounts.length) {
    decisions.push(<li key="a"><a href="#/accounts">{pendingAccounts.length} account(s) to review</a></li>)
  }
  if (ctx.isResearch && unreviewedRm.length) {
    decisions.push(<li key="r"><a href="#/assignments">{unreviewedRm.length} memo(s) need a reviewer</a></li>)
  }

  return (
    <div className="dashboard">
      <section className="dashboard-section dashboard-welcome">
        <span className="dashboard-eyebrow">MEMBER WORKSPACE</span>
        <h1>Welcome, {nameOf(me).split(' ')[0]}</h1>
        <p className="muted">Here is what is waiting on you this week.</p>
      </section>

      <section className="dashboard-section dashboard-nudge">
        <ProfileNudge ctx={ctx} />
      </section>

      <section className="dashboard-section dashboard-rm" aria-labelledby="rm-heading">
        <header className="dashboard-section-header">
          <h2 id="rm-heading"><Inbox size={18} /> Your Roast Mes</h2>
          <span className="dashboard-badge">{myRm.length}</span>
        </header>
        {myRm.length ? (
          <div className="dashboard-list">
            {myRm.map((o) => (
              <div className="dashboard-row-wrap" key={o.id}>
                <ObligationRow ctx={ctx} ob={o} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>No Roast Me due right now. You can still start one from your initiative’s Documents tab.</Empty>
        )}
      </section>

      <section className="dashboard-section dashboard-reviews" aria-labelledby="reviews-heading">
        <header className="dashboard-section-header">
          <h2 id="reviews-heading"><ClipboardList size={18} /> Your reviews</h2>
          <span className="dashboard-badge">{myReviews.length}</span>
        </header>
        {myReviews.length ? (
          <div className="dashboard-list">
            {myReviews.map((o) => (
              <div className="dashboard-row-wrap" key={o.id}>
                <ObligationRow ctx={ctx} ob={o} />
              </div>
            ))}
          </div>
        ) : (
          <Empty>No manual reviews assigned to you.</Empty>
        )}
      </section>

      {decisions.length ? (
        <section className="dashboard-section dashboard-decisions" aria-labelledby="decisions-heading">
          <header className="dashboard-section-header">
            <h2 id="decisions-heading"><ShieldCheck size={18} /> Decisions waiting on you</h2>
            <span className="dashboard-badge dashboard-badge-coral">{decisions.length}</span>
          </header>
          <ul className="dashboard-decision-list">{decisions}</ul>
        </section>
      ) : null}

      {openThreads.length ? (
        <section className="dashboard-section dashboard-threads" aria-labelledby="threads-heading">
          <header className="dashboard-section-header">
            <h2 id="threads-heading"><MessageSquare size={18} /> Open comment threads</h2>
            <span className="dashboard-badge">{openThreads.length}</span>
          </header>
          <div className="dashboard-threads-list">
            {openThreads.map((t) => {
              const doc = data.documents.find((x) => x.id === t.documentId)
              return (
                <div className="card dashboard-thread-card" key={t.id}>
                  <div className="between">
                    <span className="dashboard-thread-quote">&ldquo;{t.quote}&rdquo;</span>
                    <a className="btn ghost sm" href={`#/document/${t.documentId}`}>Open {doc?.title}</a>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="dashboard-section dashboard-initiatives" aria-labelledby="initiatives-heading">
        <header className="dashboard-section-header">
          <h2 id="initiatives-heading"><FlaskConical size={18} /> Your initiatives</h2>
          <span className="dashboard-badge">{myInitiatives.length}</span>
        </header>
        {myInitiatives.length ? (
          <div className="card-grid dashboard-initiatives-grid">
            {myInitiatives.map((i) => (
              <div className="dashboard-card-wrap" key={i.id}>
                <InitiativeCard ctx={ctx} ini={i} />
              </div>
            ))}
          </div>
        ) : <Empty>You are not on a team yet. Browse the <a href="#/catalog">catalog</a>.</Empty>}
      </section>
    </div>
  )
}

function DocumentModal({ctx,documentId,onClose}:{ctx:Ctx;documentId:string;onClose:()=>void}){
  const doc=ctx.data.documents.find(d=>d.id===documentId)
  const ini=doc?ctx.data.initiatives.find(i=>i.id===doc.initiativeId):undefined
  const [work,setWork]=useState({unsaved:false,uploads:0})
  if(!doc||!ini)return null
  const requestClose=()=>{
    if(work.uploads>0){if(!window.confirm('An image upload is still running. Close and stop inserting it into this editor?'))return}
    else if(work.unsaved&&!window.confirm('Close with unsaved Roast Me changes?'))return
    onClose()
  }
  const canEdit=doc.authorId===ctx.userId||(doc.kind==='rm'&&ini.members.includes(ctx.userId??''))
  return <Modal titleId="rm-modal-title" onRequestClose={requestClose}>
    <div className="between"><h2 id="rm-modal-title">{doc.title}</h2>
      <div className="row"><a className="btn ghost sm" href={`#/document/${doc.id}`} onClick={e=>{
        if(work.uploads>0&&!window.confirm('An image upload is running. Leave this modal?'))e.preventDefault()
        else if(work.unsaved&&!window.confirm('Open the full page with unsaved changes?'))e.preventDefault()
      }}>Open full page</a>
        <button className="btn ghost sm" onClick={requestClose} aria-label="Close"><X size={16}/></button></div></div>
    {doc.status==='draft'&&canEdit
      ? <DraftEditor ctx={ctx} doc={doc} ini={ini} onWorkState={setWork} onSubmitted={onClose}/>
      : doc.status==='draft'
        ? <p className="muted">This document is still a private draft.</p>
        : <SubmittedDoc key={doc.id} ctx={ctx} doc={doc} ini={ini}/>}
  </Modal>
}

function PageInitiative({ ctx }: { ctx: Ctx }) {
  const id = ctx.route.parts[1]
  const tab = ctx.route.parts[2] ?? 'overview'
  const ini = ctx.data.initiatives.find((i) => i.id === id)
  const [taskModalId,setTaskModalId]=useState<string|null>(null)
  const [documentModalId,setDocumentModalId]=useState<string|null>(null)
  const [documentSort,setDocumentSort]=useState<DocumentSort>('newest')
  const [taskSort,setTaskSort]=useState<TaskSort>('due')
  if (!ini) return <NotFound />

  const internal = ctx.approved
  if (!internal && ini.status !== 'active') {
    return <div className="card"><h3>{ini.title}</h3><p className="muted">This initiative is not public.</p></div>
  }

  const isMember = !!ctx.userId && (ini.members.includes(ctx.userId) || ini.leadId === ctx.userId)
  const canManage = ini.leadId === ctx.userId || ctx.isAdmin
  const initiativeDocs = ctx.data.documents.filter((d) => d.initiativeId === ini.id)
  // Canonical historical records are imported as one RM/review pair per source
  // week. Keep live documents in their existing order, while presenting those
  // historical weeks chronologically with the RM before its linked review.
  const docs = sortDocuments(initiativeDocs,documentSort)
  const tasks = sortTasks(ini.tasks,taskSort)
  const joinReqs = ctx.data.requests.filter((r) =>
    r.kind === 'join' && r.initiativeId === ini.id && r.status === 'pending')
  const myPendingJoin = ctx.data.requests.some((r) =>
    r.kind === 'join' && r.initiativeId === ini.id && r.userId === ctx.userId && r.status === 'pending')
  const activity = ctx.data.audit.filter((a) => a.detail.includes(`[${ini.id}]`))

  const tabs = internal
    ? ['overview', 'tasks', 'team', 'documents', 'activity']
    : ['overview', 'team']

  const done = ini.tasks.filter((t) => t.status === 'finished').length

  let hash = 0
  for (let i = 0; i < ini.id.length; i++) hash = ini.id.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  const bg = ini.coverUrl 
    ? `url(${ini.coverUrl}) ${ini.coverPositionX??50}% ${ini.coverPositionY??50}%/cover no-repeat`
    : (ini.coverFallbackColor || `hsl(${hue}, 65%, 85%)`)

  return (
    <div>
      <div style={{ height: 160, background: bg, margin: '-20px -20px 20px -20px' }} />
      <div className="section">
        <p className="muted"><a href="#/catalog"><ArrowLeft size={13} /> Catalog</a></p>
        <div className="between">
          <h1 style={{ marginBottom: 6 }}>{ini.title}</h1>
          <Pill tone={statusTone(ini.status)}>{ini.status}</Pill>
        </div>
        <div className="row">
          <Pill>{ini.category}</Pill>
          <span className="muted">Lead: {ctx.personName(ini.leadId)}</span>
          {internal ? <HpBar hp={ini.hp} /> : null}
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={`tab ${t === tab ? 'active' : ''}`}
            onClick={() => go(`#/initiative/${ini.id}/${t}`)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="card">
          <div className="between">
            <h3>Abstract</h3>
            {(ini.leadId === ctx.userId || ctx.isAdmin) ? <CoverForm ctx={ctx} ini={ini} /> : null}
          </div>
          <p style={{ marginTop: 8 }}>{ini.abstract}</p>
          {ini.motivation ? (
            <div style={{ marginTop: 24 }}>
              <h3>Motivation</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{ini.motivation}</p>
            </div>
          ) : null}
          <div style={{ marginTop: 16 }}>
            {!ctx.approved ? (
              <p className="muted">Sign in with an approved account to join or see the workspace.</p>
            ) : isMember ? (
              <Pill tone="good">You are on this team</Pill>
            ) : myPendingJoin ? (
              <Pill tone="warn">Join request pending</Pill>
            ) : (
              <JoinForm ctx={ctx} initiativeId={ini.id} />
            )}
          </div>
        </div>
      ) : null}

      {tab === 'tasks' && internal ? (
        <div className="card">
          <div className="between">
            <h3>Tasks</h3>
            <div className="row"><span className="muted">{done}/{ini.tasks.length} done</span>
              <select aria-label="Sort tasks" value={taskSort} onChange={e=>setTaskSort(e.target.value as TaskSort)}>
                <option value="due">Due date</option><option value="title">Title</option><option value="status">Status</option>
              </select>
            </div>
          </div>
          <div className="stack" style={{ margin: '12px 0' }}>
            {tasks.length ? tasks.map((t) => (
              <div key={t.id} className="task-row">
                <div style={{ flex: 1 }}><strong style={{ textDecoration: t.status === 'finished' ? 'line-through' : 'none' }}>{t.title}</strong>
                  {/* Rendered through the read-only editor after sanitize(), the
                      same path every other stored body takes - no raw HTML is
                      injected, and inline images resolve from their object path. */}
                  {t.description
                    ? <div className="task-description">
                        <Editor body={sanitize(t.description)} readOnly />
                      </div>
                    : null}
                  <div className="row field-hint">
                    {t.assigneeId ? <span>Assigned to {ctx.personName(t.assigneeId)}</span> : <span>Unassigned</span>}
                    {t.dueAt ? <span>Due {fmtDateTime(t.dueAt)}</span> : null}
                  </div>
                </div>
                <Pill tone={t.status==='finished'?'good':t.status==='pending'?'warn':'muted'}>{t.status}</Pill>
                <button className="btn ghost sm" onClick={()=>setTaskModalId(t.id)}>Open task</button>
              </div>
            )) : <Empty>No tasks yet.</Empty>}
          </div>
          {canManage ? <AddTaskForm ctx={ctx} ini={ini} /> : null}
          {taskModalId?<TaskModal key={taskModalId} ctx={ctx} ini={ini} taskId={taskModalId} onClose={()=>setTaskModalId(null)}/>:null}
        </div>
      ) : null}

      {tab === 'team' ? (
        <div>
          <div className="card">
            <h3>Team</h3>
            <div className="stack" style={{ marginTop: 10 }}>
              {ini.members.map((mid) => {
                const p = ctx.data.people.find((x) => x.id === mid)
                if (!p) return null
                const canTransfer = ctx.approved && (ctx.userId === ini.leadId || ctx.isResearch) && ini.leadId !== mid && p.status === 'approved'
                const canLeave = mid === ctx.userId && ini.leadId !== mid && p.status === 'approved'
                const isLeadAndMe = mid === ctx.userId && ini.leadId === mid
                return (
                  <div className="between" key={mid}>
                    <div>
                      <div className="row">
                        <strong>{nameOf(p)}</strong>
                        {ini.leadId === mid ? <Pill tone="good">lead</Pill> : null}
                        {internal ? <RoleBadges person={p} /> : null}
                      </div>
                      {internal && (p.major || p.interests) ? (
                        <div className="field-hint">
                          {[p.major, p.interests].filter(Boolean).join(' - ')}
                        </div>
                      ) : null}
                    </div>
                    <div className="row">
                      {canTransfer ? (
                        <button className="btn ghost sm" disabled={ctx.busy} onClick={async () => {
                          if (window.confirm(`Transfer leadership to ${nameOf(p)}?`)) {
                            await ctx.run('transferLead', { initiativeId: ini.id, userId: mid }, 'Leadership transferred.')
                          }
                        }}>Make lead</button>
                      ) : null}
                      {canLeave ? (
                        <button className="btn danger sm" disabled={ctx.busy} onClick={async () => {
                          if (window.confirm(`Leave ${ini.title}?`)) {
                            const ok = await ctx.run('leaveInitiative', { initiativeId: ini.id, userId: mid }, 'Left initiative.')
                            if (ok) go('#/')
                          }
                        }}>Leave team</button>
                      ) : null}
                      {isLeadAndMe ? (
                        <span className="field-hint">Transfer leadership before leaving.</span>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          {canManage && joinReqs.length ? (
            <div className="section" style={{ marginTop: 16 }}>
              <h2>Join requests</h2>
              {joinReqs.map((r) => (
                <div className="card" key={r.id}>
                  <div className="between">
                    <div>
                      <strong>{ctx.personName(r.userId)}</strong>
                      <p className="muted">{r.body}</p>
                    </div>
                  </div>
                  <DecisionForm
                    ctx={ctx}
                    approveLabel="Add to team"
                    onApprove={() => ctx.run('decideJoin',
                      { requestId: r.id, decision: 'approved' }, 'Member added.')}
                    onReject={(fb) => ctx.run('decideJoin',
                      { requestId: r.id, decision: 'rejected', feedback: fb }, 'Request declined.')}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'documents' && internal ? (
        <div className="card">
          <div className="between">
            <h3>Documents</h3>
            <div className="row">
              <select aria-label="Sort documents" value={documentSort} onChange={e=>setDocumentSort(e.target.value as DocumentSort)}>
                <option value="newest">Newest first</option><option value="title">Title</option>
                <option value="kind">Kind</option><option value="status">Status</option>
              </select>
              {isMember ? <StartRoastMe ctx={ctx} ini={ini} onOpen={setDocumentModalId} /> : null}
            </div>
          </div>
          <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}><table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Title</th><th>Kind</th><th>Status</th><th>Period / submitted</th></tr>
            </thead>
            <tbody>
              {docs.length ? docs.map((d) => (
                <tr key={d.id}>
                  <td><a href={`#/document/${d.id}`} onClick={(e)=>{
                    if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey&&e.button===0){e.preventDefault();setDocumentModalId(d.id)}
                  }}>{d.title}</a>{d.historical && (d.sourceWeek || d.sourcePeriod) ? <div className="field-hint">{d.sourceWeek ? `Week: ${d.sourceWeek}` : d.sourcePeriod}</div> : null}</td>
                  <td>{d.kind === 'rm' ? 'Roast Me' : 'review'}{d.historical ? ' (historical)' : ''}{!d.historical && d.kind === 'rm' && d.targetMonday ? <div className="field-hint">Week of {d.targetMonday}</div> : null}</td>
                  <td><Pill tone={statusTone(d.status)}>{d.status}</Pill></td>
                  <td>{d.historical
                    ? [d.sourcePeriod,d.sourceWeek].filter(Boolean).join(' · ') || 'Historical period unavailable'
                    : d.submittedAt ? fmtDate(d.submittedAt) : d.targetMonday ? `Week of ${d.targetMonday}` : 'Date unavailable'}</td>
                </tr>
              )) : <tr><td colSpan={4} className="muted">No documents yet.</td></tr>}
            </tbody>
          </table></div>
        </div>
      ) : null}

      {documentModalId?<DocumentModal key={documentModalId} ctx={ctx} documentId={documentModalId} onClose={()=>setDocumentModalId(null)}/>:null}

      {tab === 'activity' && internal ? (
        <div className="card">
          <h3>Activity</h3>
          {activity.length ? (
            <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}><table className="table">
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</td>
                    <td>{a.actor}</td>
                    <td>{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          ) : <Empty>No recorded activity.</Empty>}
        </div>
      ) : null}
    </div>
  )
}

function PageDocument({ ctx }: { ctx: Ctx }) {
  const id = ctx.route.parts[1]
  const doc = ctx.data.documents.find((d) => d.id === id)
  if (!doc) return <NotFound />
  const ini = ctx.data.initiatives.find((i) => i.id === doc.initiativeId)
  if (!ini) return <NotFound />

  if (doc.status === 'draft') {
    const canEdit = doc.authorId === ctx.userId ||
      (doc.kind === 'rm' && !!ctx.userId && ini.members.includes(ctx.userId))
    if (!canEdit) {
      return <div className="card"><h3>{doc.title}</h3><p className="muted">This document is still a draft.</p></div>
    }
    return (
      <div>
        <p className="muted">
          <a href={`#/initiative/${ini.id}/documents`}><ArrowLeft size={13} /> {ini.title}</a>
        </p>
        <DraftEditor ctx={ctx} doc={doc} ini={ini} />
      </div>
    )
  }
  // Keyed on the document so the selected version - and the Research revision
  // form inside - reset when the route moves to another memo.
  return <SubmittedDoc key={doc.id} ctx={ctx} doc={doc} ini={ini} />
}

function PageProposals({ ctx }: { ctx: Ctx }) {
  const mine = ctx.data.requests.filter((r) => r.kind === 'proposal' && r.userId === ctx.userId)
  const queue = ctx.data.requests.filter((r) => r.kind === 'proposal' && r.status === 'submitted')
  return (
    <div>
      <div className="between section">
        <h1>Proposals</h1>
        <a className="btn" href="#/new-proposal"><Plus size={16} /> New proposal</a>
      </div>

      {ctx.isResearch ? (
        <div className="section">
          <h2>Awaiting Research review</h2>
          {queue.length ? queue.map((r) => {
            const { category, abstract, plan, motivation } = readProposal(r.body)
            return (
              <div className="card" key={r.id}>
                <div className="between">
                  <div>
                    <h3 style={{ marginBottom: 4 }}>{r.title}</h3>
                    <div className="row">
                      <Pill>{category}</Pill>
                      <span className="muted">by {ctx.personName(r.userId)}</span>
                    </div>
                  </div>
                </div>
                <p style={{ marginTop: 8 }}>{abstract}</p>
                {plan ? (
                  <p style={{ marginTop: 8 }}><strong>Execution plan:</strong> {plan}</p>
                ) : null}
                {motivation ? (
                  <p style={{ marginTop: 8 }}><strong>Motivation:</strong> {motivation}</p>
                ) : null}
                <DecisionForm
                  ctx={ctx}
                  approveLabel="Approve & create initiative"
                  onApprove={() => ctx.run('decideProposal',
                    { requestId: r.id, decision: 'approved' }, 'Initiative created.')}
                  onReject={(fb) => ctx.run('decideProposal',
                    { requestId: r.id, decision: 'rejected', feedback: fb }, 'Proposal declined.')}
                  onChanges={(fb) => ctx.run('decideProposal',
                    { requestId: r.id, decision: 'changes_requested', feedback: fb }, 'Change request sent.')}
                />
              </div>
            )
          }) : <Empty>Nothing waiting.</Empty>}
        </div>
      ) : null}

      <div className="section">
        <h2>Your proposals</h2>
        {mine.length ? mine.map((r) => {
          const { category, abstract, plan, motivation } = readProposal(r.body)
          const editable = r.status === 'draft' || r.status === 'changes_requested'
          return (
            <div className="card" key={r.id}>
              <div className="between">
                <div>
                  <strong>{r.title}</strong>{' '}
                  <Pill>{category}</Pill>
                </div>
                <Pill tone={statusTone(r.status)}>{r.status}</Pill>
              </div>
              <p className="muted" style={{ marginTop: 6 }}>{abstract}</p>
              {plan ? <p className="muted"><strong>Execution plan:</strong> {plan}</p> : null}
              {motivation ? <p className="muted"><strong>Motivation:</strong> {motivation}</p> : null}
              {r.feedback ? <p><strong>Feedback:</strong> {r.feedback}</p> : null}
              {editable ? (
                <a className="btn ghost sm" href={`#/new-proposal/${r.id}`}>
                  {r.status === 'draft' ? 'Continue draft' : 'Revise & resubmit'}
                </a>
              ) : null}
            </div>
          )
        }) : <Empty>You have not proposed anything yet.</Empty>}
      </div>
    </div>
  )
}

function PageRequests({ ctx }: { ctx: Ctx }) {
  const ledIds = ctx.data.initiatives.filter((i) => i.leadId === ctx.userId).map((i) => i.id)
  const reqs = ctx.data.requests.filter((r) =>
    r.kind === 'join' && r.status === 'pending' &&
    (ctx.isAdmin || ledIds.includes(r.initiativeId ?? '')))
  return (
    <div>
      <h1 className="section">Join requests</h1>
      {reqs.length ? reqs.map((r) => {
        const ini = ctx.data.initiatives.find((i) => i.id === r.initiativeId)
        return (
          <div className="card" key={r.id}>
            <div className="between">
              <div>
                <strong>{ctx.personName(r.userId)}</strong> &rarr; {ini?.title}
                <p className="muted">{r.body}</p>
              </div>
            </div>
            <DecisionForm
              ctx={ctx}
              approveLabel="Add to team"
              onApprove={() => ctx.run('decideJoin',
                { requestId: r.id, decision: 'approved' }, 'Member added.')}
              onReject={(fb) => ctx.run('decideJoin',
                { requestId: r.id, decision: 'rejected', feedback: fb }, 'Request declined.')}
            />
          </div>
        )
      }) : <Empty>No pending requests.</Empty>}
    </div>
  )
}

function PageAccounts({ ctx }: { ctx: Ctx }) {
  const people = [...ctx.data.people].sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  const pending = people.filter((p) => p.status === 'pending')
  return (
    <div>
      <h1 className="section">Accounts</h1>

      <div className="section">
        <h2>Pending approval</h2>
        {pending.length ? pending.map((p) => (
          <div className="card" key={p.id}>
            <div className="between">
              <div>
                <div><strong>{nameOf(p)}</strong> <span className="muted">{p.email}</span></div>
                {p.major ? <div className="field-hint">Major: {p.major}</div> : null}
                {p.interests ? <div className="field-hint">Interests: {p.interests}</div> : null}
              </div>
              <Pill tone="warn">pending</Pill>
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                className="btn sm" disabled={ctx.busy || p.id === ctx.userId}
                onClick={() => ctx.run('decideAccount', { userId: p.id, status: 'approved' }, 'Account approved.')}
              >
                <Check size={15} /> Approve
              </button>
              <ReasonAction
                ctx={ctx} label="Reject" tone="danger" placeholder="Reason for rejection"
                onSubmit={(reason) => ctx.run('decideAccount',
                  { userId: p.id, status: 'rejected', reason }, 'Account rejected.')}
              />
            </div>
            {p.id === ctx.userId ? <p className="field-hint">You cannot decide your own account.</p> : null}
          </div>
        )) : <Empty>No accounts waiting.</Empty>}
      </div>

      <div className="section">
        <h2>All accounts</h2>
        <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}><table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Status</th><th>Roles</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>
                  {nameOf(p)}
                  {p.major ? <div className="field-hint">{p.major}</div> : null}
                </td>
                <td className="muted">{p.email}</td>
                <td><Pill tone={statusTone(p.status)}>{accountStatusLabel(p)}</Pill></td>
                <td>
                  {ctx.isOperations && p.id !== ctx.userId && p.status === 'approved' ? (
                    <div className="btn-row">
                      {['research', 'operations', 'admin'].map((role) => {
                        const has = p.roles.includes(role)
                        return (
                          <button
                            key={role}
                            className={`btn sm ${has ? '' : 'ghost'}`}
                            disabled={ctx.busy}
                            onClick={() => ctx.run('setRole',
                              { userId: p.id, role, grant: !has },
                              has ? `Revoked ${role}.` : `Granted ${role}.`)}
                          >
                            {has ? `- ${role}` : `+ ${role}`}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    p.roles.length ? p.roles.join(', ') : <span className="muted">-</span>
                  )}
                </td>
                <td>
                  {p.id === ctx.userId ? <span className="muted">you</span> : p.status === 'approved' ? (
                    <ReasonAction
                      ctx={ctx} label="Suspend" tone="danger" placeholder="Reason for suspension"
                      onSubmit={(reason) => ctx.run('decideAccount',
                        { userId: p.id, status: 'suspended', reason }, 'Account suspended.')}
                    />
                  ) : p.status !== 'pending' ? (
                    <button
                      className="btn sm" disabled={ctx.busy}
                      onClick={() => ctx.run('decideAccount',
                        { userId: p.id, status: 'approved' }, 'Account reinstated.')}
                    >
                      Reinstate
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {!ctx.isOperations ? (
          <p className="field-hint">Only Operations or Admin can grant or revoke roles.</p>
        ) : null}
      </div>
    </div>
  )
}

function CycleControls({ ctx }: { ctx: Ctx }) {
  // Defaults to the current Los Angeles week; the date field is the override.
  const thisWeek = losAngelesMonday()
  const [monday, setMonday] = useState(thisWeek)
  const [isBreak, setIsBreak] = useState(false)
  const [penalty, setPenalty] = useState('10')
  const [reward, setReward] = useState('4')
  if (!ctx.isResearch) return null
  const cycles = ctx.data.cycles ?? []
  const current = cycles.find((c) => c.startsOn === thisWeek)
  const chosen = cycles.find((c) => c.startsOn === monday)
  const problem = !monday ? 'Choose the Monday this cycle starts on.'
    : !isMondayIso(monday) ? 'A cycle has to start on a Monday.'
    : chosen && chosen.isBreak !== isBreak
      ? `The week of ${monday} is already open as a ${chosen.isBreak ? 'break' : 'working'} week.`
      : ''
  return (
    <div className="section" style={{ marginTop: 20 }}>
      <h2><Clock size={18} /> Research cycle</h2>
      <div className="card">
        <p className="muted" style={{ marginBottom: 10 }}>
          {current
            ? `This week (${thisWeek}) is open${current.isBreak ? ' as a break week' : ''}.`
            : `This week (${thisWeek}) has not been opened yet. Teams can already draft a Roast Me for it; opening the cycle is what lets them submit.`}
        </p>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault()
            if (problem) return
            await ctx.run('openCycle', { monday, isBreak },
              `Opened the week of ${monday}.`)
          }}
        >
          <Field label="Week of (Monday)" hint={monday === thisWeek ? 'Current Los Angeles week.' : 'Manual override.'}>
            <input type="date" value={monday} disabled={ctx.busy}
              onChange={(e) => setMonday(e.target.value)} />
          </Field>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={isBreak} disabled={ctx.busy}
              onChange={(e) => setIsBreak(e.target.checked)} />
            Break week
          </label>
          <button className="btn sm" disabled={ctx.busy || !!problem}>
            {chosen ? 'Cycle already open' : 'Open cycle'}
          </button>
          {monday !== thisWeek ? (
            <button type="button" className="btn ghost sm" disabled={ctx.busy}
              onClick={() => setMonday(thisWeek)}>Use this week</button>
          ) : null}
        </form>
        {problem ? <p className="field-hint" role="alert">{problem}</p> : null}
        <p className="field-hint" style={{ marginTop: 10 }}>
          {cycles.length
            ? `Open weeks: ${cycles.slice(-6).map((c) => c.startsOn + (c.isBreak ? ' (break)' : '')).join(', ')}`
            : 'No cycle has been opened yet.'}
        </p>
      </div>
      <div className="card">
        <div className="between">
          <span className="muted">Mark every past-due obligation missed and apply the penalty.</span>
          <button
            className="btn sm" disabled={ctx.busy}
            onClick={() => ctx.run('evaluateDeadlines', {}, 'Deadlines evaluated.')}
          >
            Evaluate deadlines
          </button>
        </div>
      </div>
      <div className="card">
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault()
            await ctx.run('setPolicy',
              { penalty: Number(penalty), reward: Number(reward) }, 'Policy updated.')
          }}
        >
          <Field label="Missed penalty">
            <input type="number" value={penalty} disabled={ctx.busy} style={{ width: 90 }}
              onChange={(e) => setPenalty(e.target.value)} />
          </Field>
          <Field label="Completion reward">
            <input type="number" value={reward} disabled={ctx.busy} style={{ width: 90 }}
              onChange={(e) => setReward(e.target.value)} />
          </Field>
          <button className="btn sm" disabled={ctx.busy || !penalty.trim() || !reward.trim()}>
            Save policy
          </button>
        </form>
      </div>
    </div>
  )
}

function PageAssignments({ ctx }: { ctx: Ctx }) {
  const submittedRm = ctx.data.documents.filter((d) => !d.historical && d.kind === 'rm' && d.status === 'submitted')
  const reviewObligations = ctx.data.obligations.filter((o) => o.kind === 'review')
  return (
    <div>
      <h1 className="section">Review assignments</h1>
      <p className="muted section">
        Research assigns each Roast Me a reviewer from outside that initiative.
      </p>

      <div className="section">
        <h2>Submitted Roast Mes</h2>
        {submittedRm.length ? submittedRm.map((d) => {
          const ini = ctx.data.initiatives.find((i) => i.id === d.initiativeId)
          const existing = reviewObligations.filter((o) => o.targetId === d.id)
          return (
            <div className="card" key={d.id}>
              <div className="between">
                <div>
                  <a href={`#/document/${d.id}`}><strong>{d.title}</strong></a>
                  <p className="muted">{ini?.title}</p>
                </div>
              </div>
              {existing.length ? (
                <ul>
                  {existing.map((o) => (
                    <li key={o.id}>
                      {ctx.personName(o.assigneeId)} - <Pill tone={statusTone(o.status)}>{o.status}</Pill>
                      {' '}<span className="muted">{relDue(o.due)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="muted">No reviewer assigned.</p>}
              <AssignReviewForm ctx={ctx} target={d} />
            </div>
          )
        }) : <Empty>No submitted memos.</Empty>}
      </div>

      <div className="section">
        <h2>All review obligations</h2>
        <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}><table className="table">
          <thead>
            <tr><th>Reviewed</th><th>Reviewer</th><th>Status</th><th>Due</th></tr>
          </thead>
          <tbody>
            {reviewObligations.length ? reviewObligations.map((o) => {
              const target = ctx.data.documents.find((d) => d.id === o.targetId)
              return (
                <tr key={o.id}>
                  <td>{target?.title ?? '-'}</td>
                  <td>{ctx.personName(o.assigneeId)}</td>
                  <td><Pill tone={statusTone(o.status)}>{o.status}</Pill></td>
                  <td>{fmtDate(o.due)}</td>
                </tr>
              )
            }) : <tr><td colSpan={4} className="muted">None.</td></tr>}
          </tbody>
        </table></div>
      </div>

      <CycleControls ctx={ctx} />
    </div>
  )
}

function PageHealth({ ctx }: { ctx: Ctx }) {
  const canStatus = ctx.isResearch
  const canHp = ctx.isResearch
  return (
    <div>
      <h1 className="section">Initiative health</h1>
      <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}><table className="table">
        <thead>
          <tr>
            <th>Initiative</th><th>Lead</th><th>Status</th><th>HP</th>
            <th>Members</th><th>Open work</th>
          </tr>
        </thead>
        <tbody>
          {ctx.data.initiatives.map((i) => {
            const open = ctx.data.obligations.filter((o) =>
              o.initiativeId === i.id && (o.status === 'pending' || o.status === 'missed')).length
            return (
              <tr key={i.id}>
                <td><a href={`#/initiative/${i.id}/overview`}>{i.title}</a></td>
                <td>{ctx.personName(i.leadId)}</td>
                <td><Pill tone={statusTone(i.status)}>{i.status}</Pill></td>
                <td>
                  <HpBar hp={i.hp} />
                  {i.hp === 0 ? (
                    <div className="pill bad" style={{ marginTop: 4 }}>
                      <TriangleAlert size={13} /> needs human action
                    </div>
                  ) : null}
                </td>
                <td>{i.members.length}</td>
                <td>{open}</td>
              </tr>
            )
          })}
        </tbody>
      </table></div>

      {canStatus || canHp ? (
        <div className="section" style={{ marginTop: 20 }}>
          <h2>Adjust</h2>
          {ctx.data.initiatives.map((i) => (
            <div className="card" key={i.id}>
              <div className="between">
                <strong>{i.title}</strong>
                <HpBar hp={i.hp} />
              </div>
              <div className="stack" style={{ marginTop: 10 }}>
                {canStatus ? <SetStatusForm ctx={ctx} ini={i} /> : null}
                {canHp ? <AdjustHpForm ctx={ctx} ini={i} /> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="field-hint" style={{ marginTop: 16 }}>
          Research can change initiative status and HP from this page.
        </p>
      )}

      <CycleControls ctx={ctx} />
    </div>
  )
}

function PageAudit({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState('')
  const rows = ctx.data.audit.filter((a) =>
    `${a.actor} ${a.action} ${a.detail}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div>
      <h1 className="section">Audit history</h1>
      <input
        type="search" placeholder="Filter" value={q} className="section"
        style={{ maxWidth: 320 }} onChange={(e) => setQ(e.target.value)}
      />
      <div className="table-scroll" role="region" aria-label="Scrollable data table" tabIndex={0}><table className="table">
        <thead>
          <tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((a) => (
            <tr key={a.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</td>
              <td>{a.actor}</td>
              <td><code>{a.action}</code></td>
              <td>{a.detail}</td>
            </tr>
          )) : <tr><td colSpan={4} className="muted">No entries.</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}

function PageNotifications({ ctx }: { ctx: Ctx }) {
  const notifications = (ctx.data.notifications || []).filter((n) => n.userId === ctx.userId)
  notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  const renderContent = (n: Notification) => {
    const p = n.payload || {}
    let title = 'Notification'
    let body: ReactNode = ''

    if (n.kind === 'join_decided') {
      title = 'Join request decided'
      body = p.approved ? 'Your request to join the initiative was approved.' : 'Your request to join the initiative was declined.'
    } else if (n.kind === 'proposal_decided') {
      title = 'Proposal decided'
      body = `Your proposal is now ${p.status}.`
    } else if (n.kind === 'review_assigned') {
      title = 'Review assigned'
      const obl = ctx.data.obligations.find(o => o.id === p.obligation_id)
      if (obl && obl.targetId) {
        body = <span>You have been assigned to <a href={`#/document/${obl.targetId}`}>review a document</a>.</span>
      } else {
        body = 'You have been assigned a review.'
      }
    } else if (n.kind === 'review_unassigned') {
      title = 'Review needs reassignment'
      body = <span>A review in your initiative needs a new reviewer. See <a href="#/assignments">Research assignments</a>.</span>
    } else {
      title = n.kind.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      body = 'You have a new notification.'
    }

    return (
      <div>
        <strong>{title}</strong>
        <div className="muted">{fmtDateTime(n.createdAt)}</div>
        {body ? <p style={{ marginTop: 6 }}>{body}</p> : null}
      </div>
    )
  }

  return (
    <div>
      <h1 className="section">Inbox</h1>
      {notifications.length ? notifications.map((n) => (
        <div className="card" key={n.id} style={{ opacity: n.readAt ? 0.7 : 1 }}>
          <div className="between">
            {renderContent(n)}
            {!n.readAt ? (
              <button
                className="btn sm"
                disabled={ctx.busy}
                onClick={() => ctx.run('readNotification', { id: n.id }, 'Marked as read.')}
              >
                <Check size={15} /> Mark read
              </button>
            ) : null}
          </div>
        </div>
      )) : <Empty>No notifications.</Empty>}
    </div>
  )
}

// --- root -----------------------------------------------------------

const GUARDED = new Set([
  'proposals', 'new-proposal', 'requests', 'accounts', 'assignments', 'health', 'audit', 'document', 'notifications',
])

export default function App({ data, userId, onAction, mode, onSignIn, onVerifyCode, onVerifyLink, onSignOut, authEmail }: AppProps) {
  const [route, setRoute] = useState<Route>(() => parseHash())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const mainRef = useRef<HTMLDivElement>(null)
  const navToggleRef = useRef<HTMLButtonElement>(null)
  const navMenuRef = useRef<HTMLDivElement>(null)
  const closeNavigation = (afterRoute = false) => {
    setNavOpen(false)
    requestAnimationFrame(() => (afterRoute ? mainRef.current : navToggleRef.current)?.focus())
  }
  const [dark,setDark]=useState(readDarkTheme)

  useEffect(()=>{localStorage.setItem('openlabs-theme',dark?'dark':'light')},[dark])

  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && navOpen) closeNavigation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navOpen])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (navOpen && event.target instanceof Node && !navMenuRef.current?.contains(event.target)) closeNavigation()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [navOpen])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const me = userId ? data.people.find((p) => p.id === userId) ?? null : null
  const approved = me?.status === 'approved'
  const actualRoles = roleLabels(me?.roles ?? [])
  /**
   * Role preview: a display-only simulation of a NARROWER role, so a lead or
   * admin can see what an ordinary Member sees.
   *
   * It can only ever remove grants - `previewRoles` is kept to a subset of the
   * account's own - so it cannot show a capability the account does not have.
   * It grants nothing and changes no role.
   */
  const [previewRoles, setPreviewRoles] = useState<string[] | null>(null)
  const previewing = previewRoles !== null && approved
  const roles = previewing ? previewRoles! : actualRoles
  const isResearch = approved && (roles.includes('research') || roles.includes('admin'))
  const isOperations = approved && (roles.includes('operations') || roles.includes('admin'))
  const isAdmin = isResearch || isOperations

  /**
   * Read at dispatch time, not captured. A callback built before the preview
   * started - a queued autosave, a file picker handler, an upload retry - still
   * sees the current value when it finally fires, so entering preview stops work
   * that was already in flight rather than only work started afterwards.
   */
  const previewingRef = useRef(false)
  previewingRef.current = previewing

  // One gateway for every mutation, so no entrypoint can route around the
  // preview refusal. src/preview-gateway.test.ts exercises these exact objects.
  const { guard, run, uploadRmImage, uploadTaskImage } = useMemo(
    () => createMutationGateway({
      onAction,
      isPreviewing: () => previewingRef.current,
      setBusy, setError, setNotice,
    }),
    [onAction],
  )

  const ctx: Ctx = {
    data, me, userId, approved, isResearch, isOperations, isAdmin, mode, busy, route,
    authEmail: authEmail ?? null,
    personName: (id) => {
      const p = data.people.find((x) => x.id === id)
      return p ? nameOf(p) : 'Unknown'
    },
    run,
    onSignIn: (email, details) =>
      guard(() => onSignIn(email, details), 'Check your email for sign-in instructions.'),
    onVerifyCode: onVerifyCode
      ? (email, code) => guard(() => onVerifyCode(email, code)).then(() => undefined)
      : undefined,
    onVerifyLink: onVerifyLink
      ? (tokenHash) => guard(() => onVerifyLink(tokenHash))
      : undefined,
    onSignOut: () => guard(() => onSignOut()).then(() => undefined),
    // Both uploads are mutations - they write bytes and register a row - so they
    // come from the same gateway as `run`, not from a second path.
    uploadRmImage,
    uploadTaskImage,
  }

  const leads = !!userId && data.initiatives.some((i) => i.leadId === userId)
  const navAccess = navigationAccess({
    approved: !!approved, isResearch, isOperations, isInitiativeLead: leads,
  })
  const unreadCount = userId ? (data.notifications || []).filter((n) => n.userId === userId && !n.readAt).length : 0
  const nav: { to: string; label: string; icon: typeof House; show: boolean }[] = [
    { to: '#/', label: 'Home', icon: House, show: true },
    { to: '#/catalog', label: 'Catalog', icon: FlaskConical, show: true },
    { to: '#/signin', label: 'Sign in', icon: LogIn, show: !me && mode === 'live' },
    { to: '#/notifications', label: unreadCount ? `Inbox (${unreadCount})` : 'Inbox', icon: Bell, show: approved },
    { to: '#/proposals', label: 'Proposals', icon: Sparkles, show: approved },
    { to: '#/requests', label: 'Join requests', icon: UserPlus, show: navAccess.joinRequests },
    { to: '#/assignments', label: 'Review assignments', icon: ClipboardList, show: isResearch },
    { to: '#/accounts', label: 'Accounts', icon: ShieldCheck, show: navAccess.accounts },
    { to: '#/health', label: 'Health', icon: HeartPulse, show: approved },
    { to: '#/audit', label: 'Audit', icon: Clock, show: navAccess.audit },
    // Settings stays last and is visually pinned above the sidebar footer.
    { to: '#/settings', label: 'Settings', icon: Settings, show: true },
  ]

  function render(): ReactNode {
    if (GUARDED.has(route.name) && !approved) return <AccessNeeded ctx={ctx} />
    if (route.name === 'accounts' && !navAccess.accounts) return <NotFound />
    if (route.name === 'audit' && !navAccess.audit) return <NotFound />
    if (route.name === 'requests' && !navAccess.joinRequests) return <NotFound />
    if (route.name === 'assignments' && !ctx.isResearch) return <NotFound />
    switch (route.name) {
      case '': return <PageHome ctx={ctx} />
      case 'catalog': return <PageCatalog ctx={ctx} />
      case 'signin': return <PageSignIn ctx={ctx} />
      case 'confirm-email': return <EmailLinkConfirm ctx={ctx} />
      case 'auth-error': return <AuthLinkError expired={route.parts[0] === 'otp_expired'} signedIn={!!me} />
      case 'settings':
      case 'profile': return <PageSettings
        ctx={ctx} dark={dark} onToggleDark={() => setDark((v) => !v)}
        actualRoles={actualRoles} previewing={previewing} previewRoles={previewRoles}
        setPreviewRoles={setPreviewRoles}
      />
      case 'initiative': return <PageInitiative ctx={ctx} />
      case 'document': return <PageDocument ctx={ctx} />
      case 'new-proposal': return <NewProposalForm ctx={ctx} />
      case 'proposals': return <PageProposals ctx={ctx} />
      case 'requests': return <PageRequests ctx={ctx} />
      case 'accounts': return <PageAccounts ctx={ctx} />
      case 'assignments': return <PageAssignments ctx={ctx} />
      case 'health': return <PageHealth ctx={ctx} />
      case 'audit': return <PageAudit ctx={ctx} />
      case 'notifications': return <PageNotifications ctx={ctx} />
      default: return <NotFound />
    }
  }

  const narrow = route.name === 'new-proposal' || route.name === 'signin' ||
    route.name === 'settings' || route.name === 'profile'
  return (
    <div className={`ol ${dark?'theme-dark':''}`}>
      <NeuralBackground />
      <div className="ol-main" ref={mainRef} tabIndex={-1}>
        <TopBar ctx={ctx} nav={nav} route={route} navOpen={navOpen} navToggleRef={navToggleRef}
          navMenuRef={navMenuRef} onNavigate={() => closeNavigation(true)} onToggleNav={() => setNavOpen((open) => !open)} />
        {previewing ? (
          <div className="preview-banner" role="status">
            <span>
              <strong>Role preview</strong> — you are seeing The External Brain as
              {' '}{previewRoles!.length ? previewRoles!.join(' + ') : 'an ordinary Member'}.
              Nothing can be changed while this is on, and your real
              {' '}{actualRoles.length ? actualRoles.join(' + ') : 'Member'} access is untouched.
            </span>
            <button className="btn sm" onClick={() => setPreviewRoles(null)}>Exit preview</button>
          </div>
        ) : null}
        <div className={`ol-page ${narrow ? 'ol-page-narrow' : ''}`}>
          {render()}
        </div>
      </div>
      <Toasts
        error={error} notice={notice}
        onClear={() => { setError(null); setNotice(null) }}
      />
      {busy ? <div className="ol-busy" aria-hidden="true" /> : null}
    </div>
  )
}
