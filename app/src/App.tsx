/**
 * Open Labs - front-end dashboard for Decoded Brain at UC San Diego.
 *
 * App is a pure view over `data`. Every state change goes through
 * `onAction(action, payload)` which the host wires to either the local demo
 * engine (app/src/demo.ts, mode = 'demo') or the Supabase adapter
 * (root-owned, mode = 'live'). Both back ends implement the SAME action names
 * and payloads, documented here so they stay in lock-step:
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
 *   decideAccount    { userId, status:'approved'|'rejected'|'suspended', reason? }
 *       Operations or Research, never your own account. `reason` required to
 *       reject/suspend. Approval unlocks internal read + comment (no project
 *       participation implied).
 *   createDraft      { initiativeId, kind:'rm'|'review', title?, targetId? }
 *       rm: any team member. review: the assigned reviewer, and never their own
 *       initiative. Re-opens the team's existing open draft if there is one. Never
 *       creates an obligation.
 *   saveDraft        { documentId, title?, body }   (autosave; no audit entry)
 *   submitDocument   { documentId, title?, body? }
 *       rm: the initiative lead. review: the assigned reviewer (no admin override).
 *       `title`/`body` carry the live editor state so a pending autosave cannot
 *       lose edits. Appends a version, closes the matching obligation, grants +4 HP
 *       once and reverses a -10 late penalty if one was recorded. A resubmission
 *       after reviseDocument never re-earns HP.
 *   reviseDocument   { documentId }
 *       rm: the initiative lead. review: the assigned reviewer. Reopens a submitted
 *       document as a draft at the next version, keeping the first submittedAt and
 *       every recorded version.
 *   addThread        { documentId, version, quote, body }
 *       Approved account. Anchored to a submitted version + a quoted passage.
 *   replyThread      { threadId, body }
 *   resolveThread    { threadId, resolved? }        (toggles when `resolved` omitted)
 *   toggleTask       { initiativeId, taskId }        (team only)
 *   addTask          { initiativeId, title }         (lead / admin)
 *   assignReview     { targetId, reviewerId, obligationId?, due? }
 *       Research only. Points one of the reviewer's existing OPEN review
 *       obligations at the memo; `obligationId` is mandatory when the reviewer
 *       holds more than one. `due` defaults to that obligation's own deadline.
 *   setStatus        { initiativeId, status:'active'|'on_hold'|'completed'|'stopped'|'dead', reason }
 *       Research only. Any non-active status waives outstanding obligations.
 *   adjustHp         { initiativeId, delta, reason }
 *       Research only. The manual lever when HP reaches 0.
 *   setRole          { userId, role:'research'|'operations', grant:boolean }
 *       Operations only, never self.
 *   openCycle        { monday, isBreak }
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
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Data, DocumentRecord, Initiative, Obligation, Person, Thread, Notification } from './model'
import { Editor } from './Editor'
import { readProposal, sanitize } from './demo'
import { formatLosAngelesLocal, parseLosAngelesLocal } from './domain'
import {
  ArrowLeft, Bell, Check, CheckCheck, CircleAlert, ClipboardList, Clock,
  FlaskConical, HeartPulse, House, Inbox, LogIn, LogOut, MessageSquare,
  Plus, Send, ShieldCheck, Sparkles, TriangleAlert, UserPlus, X,
} from 'lucide-react'

type AppProps = {
  data: Data
  userId: string | null
  onAction: (action: string, payload: any) => Promise<void>
  mode: 'demo' | 'live'
  onSignIn: (email: string) => Promise<void>
  onSignOut: () => Promise<void>
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
  personName: (id: string) => string
  run: (action: string, payload: any, okMsg?: string) => Promise<boolean>
  onSignIn: (email: string) => Promise<void>
  onSignOut: () => Promise<void>
}

// --- small helpers --------------------------------------------------------

const CATEGORIES = [
  'Neuroengineering', 'Cognitive science', 'Neuroscience',
  'Computational modelling', 'Human-computer interaction', 'Other',
]

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '')
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

function versionsOf(doc: DocumentRecord): { version: number; body: string; at: string }[] {
  if (doc.versions.length) return [...doc.versions].sort((a, b) => a.version - b.version)
  if (doc.status !== 'draft') return [{ version: doc.version, body: doc.body, at: doc.submittedAt ?? '' }]
  return []
}

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
  if (!person.roles.length) return null
  return (
    <span className="badges">
      {person.roles.map((r) => <Pill key={r} tone="info">{r}</Pill>)}
    </span>
  )
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

function Sidebar({ nav, route, mode }: {
  nav: { to: string; label: string; icon: typeof House; show: boolean }[]
  route: Route
  mode: 'demo' | 'live'
}) {
  return (
    <aside className="ol-sidebar">
      <div className="ol-brand">
        <FlaskConical size={20} />
        <span>Open Labs</span>
      </div>
      <nav className="ol-nav">
        {nav.filter((n) => n.show).map((n) => {
          const target = n.to.replace(/^#\/?/, '').split('/')[0]
          const active = target === route.name || (target === '' && route.name === '')
          const Icon = n.icon
          return (
            <a key={n.to} href={n.to} className={active ? 'active' : ''}>
              <Icon /><span>{n.label}</span>
            </a>
          )
        })}
      </nav>
      <div className="ol-side-foot">
        Decoded Brain - UC San Diego
        <br />
        <span className="mode">
          {mode === 'demo' ? 'Demo data (fictional)' : 'Live workspace'}
        </span>
      </div>
    </aside>
  )
}

function TopBar({ ctx }: { ctx: Ctx }) {
  const [email, setEmail] = useState('')
  const people = [...ctx.data.people].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="ol-topbar">
      <div className="who">
        {ctx.me ? (
          <>
            <strong>{ctx.me.name}</strong>
            <Pill tone={statusTone(ctx.me.status)}>{ctx.me.status}</Pill>
            {ctx.me.roles.map((r) => <Pill key={r} tone="info">{r}</Pill>)}
          </>
        ) : (
          <span>Signed-out visitor</span>
        )}
      </div>
      <div className="row">
        {ctx.mode === 'demo' ? (
          <Field label="">
            <select
              aria-label="View the demo as"
              value={ctx.userId ?? ''}
              disabled={ctx.busy}
              onChange={(e) => ctx.run('switchDemoUser', { userId: e.target.value || null })}
            >
              <option value="">Signed-out visitor</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} - {p.status}{p.roles.length ? ` (${p.roles.join(', ')})` : ''}
                </option>
              ))}
            </select>
          </Field>
        ) : ctx.me ? (
          <button className="btn ghost sm" disabled={ctx.busy} onClick={() => ctx.onSignOut()}>
            <LogOut size={15} /> Sign out
          </button>
        ) : (
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!email.trim()) return
              await ctx.onSignIn(email.trim())
              setEmail('')
            }}
          >
            <input
              type="email" required placeholder="you@ucsd.edu" value={email}
              onChange={(e) => setEmail(e.target.value)} disabled={ctx.busy}
            />
            <button className="btn sm" disabled={ctx.busy}><LogIn size={15} /> Sign in</button>
          </form>
        )}
      </div>
    </div>
  )
}

// --- forms ------------------------------------------------------------

function SignInPanel({ ctx }: { ctx: Ctx }) {
  const [email, setEmail] = useState('')
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
  return (
    <div className="card">
      <h3>Sign in</h3>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!email.trim()) return
          await ctx.onSignIn(email.trim())
        }}
      >
        <Field label="University email">
          <input
            type="email" required placeholder="you@ucsd.edu" value={email}
            onChange={(e) => setEmail(e.target.value)} disabled={ctx.busy}
          />
        </Field>
        <button className="btn" disabled={ctx.busy}><LogIn size={16} /> Send sign-in link</button>
        <span className="field-hint">
          New accounts stay pending until Operations or Research approve them.
        </span>
      </form>
    </div>
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

function AddTaskForm({ ctx, initiativeId }: { ctx: Ctx; initiativeId: string }) {
  const [title, setTitle] = useState('')
  return (
    <form
      className="row"
      onSubmit={async (e) => {
        e.preventDefault()
        const ok = await ctx.run('addTask', { initiativeId, title: title.trim() }, 'Task added.')
        if (ok) setTitle('')
      }}
    >
      <input
        type="text" placeholder="Add a task" value={title} disabled={ctx.busy}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button className="btn sm" disabled={ctx.busy || !title.trim()}><Plus size={15} /> Add</button>
    </form>
  )
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

  const send = async (status: 'draft' | 'submitted') => {
    const ok = await ctx.run(
      'createProposal',
      { id: existing?.id, title: title.trim(), category, abstract: abstract.trim(), plan: plan.trim(), status },
      status === 'draft' ? 'Draft saved.' : 'Proposal submitted for Research review.',
    )
    if (ok) go('#/proposals')
  }

  const ready = title.trim().length >= 3 && abstract.trim().length >= 20 && plan.trim().length >= 20
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
            {eligible.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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

function DraftEditor({ ctx, doc, ini }: { ctx: Ctx; doc: DocumentRecord; ini: Initiative }) {
  const [title, setTitle] = useState(doc.title)
  const [body, setBody] = useState(doc.body)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!dirty.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const ok = await ctx.run('saveDraft', { documentId: doc.id, title, body })
      if (ok) { setSavedAt(Date.now()); dirty.current = false }
    }, 900)
    return () => clearTimeout(timer.current)
  }, [title, body]) // eslint-disable-line react-hooks/exhaustive-deps

  const canSubmit = doc.kind === 'rm'
    ? ini.leadId === ctx.userId
    : doc.authorId === ctx.userId

  return (
    <div className="card">
      <div className="between">
        <div>
          <Pill tone="info">draft</Pill>{' '}
          <Pill tone="muted">{doc.kind === 'rm' ? 'reporting memo' : 'manual review'}</Pill>
        </div>
        <span className="muted">
          {savedAt ? `saved ${fmtDateTime(new Date(savedAt).toISOString())}` : 'not saved yet'}
        </span>
      </div>
      <Field label="Title">
        <input
          type="text" value={title} disabled={ctx.busy}
          onChange={(e) => { dirty.current = true; setTitle(e.target.value) }}
        />
      </Field>
      <Field label="Body">
        <Editor body={body} onChange={(html) => { dirty.current = true; setBody(html) }} />
      </Field>
      <div className="btn-row">
        <button
          className="btn ghost sm"
          disabled={ctx.busy}
          onClick={async () => {
            const ok = await ctx.run('saveDraft', { documentId: doc.id, title, body }, 'Draft saved.')
            if (ok) { setSavedAt(Date.now()); dirty.current = false }
          }}
        >
          Save now
        </button>
        <button
          className="btn"
          disabled={ctx.busy || !canSubmit}
          title={canSubmit ? '' : 'Only the lead submits this document'}
          onClick={async () => {
            const label = doc.kind === 'rm' ? 'reporting memo' : 'review'
            if (!window.confirm(`Submit this ${label}? You can reopen it later to revise.`)) return
            clearTimeout(timer.current) // cancel any pending autosave
            dirty.current = false
            await ctx.run('submitDocument', { documentId: doc.id, title, body }, 'Submitted.')
          }}
        >
          <Send size={15} /> Submit
        </button>
      </div>
      {!canSubmit ? (
        <p className="field-hint">The initiative lead submits the team's reporting memo.</p>
      ) : null}
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
  const target = doc.targetId ? ctx.data.documents.find((x) => x.id === doc.targetId) : null
  const canRevise = doc.kind === 'rm'
    ? ini.leadId === ctx.userId
    : doc.authorId === ctx.userId

  return (
    <div>
      <div className="card">
        <div className="between">
          <div>
            <h3 style={{ marginBottom: 4 }}>{doc.title}</h3>
            <div className="row">
              <Pill tone="muted">{doc.kind === 'rm' ? 'reporting memo' : 'manual review'}</Pill>
              <Pill tone={statusTone(doc.status)}>{doc.status}</Pill>
              <span className="muted">by {ctx.personName(doc.authorId)}</span>
              <span className="muted">{fmtDateTime(doc.submittedAt)}</span>
            </div>
            {target ? (
              <p className="muted" style={{ marginTop: 6 }}>
                Reviewing <a href={`#/document/${target.id}`}>{target.title}</a>
              </p>
            ) : null}
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
        <Editor body={sanitize(shown?.body ?? doc.body)} readOnly />
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

function InitiativeCard({ ctx, ini }: { ctx: Ctx; ini: Initiative }) {
  return (
    <a className="card" href={`#/initiative/${ini.id}/overview`} style={{ display: 'block' }}>
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

function PageCatalog({ ctx }: { ctx: Ctx }) {
  const [q, setQ] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const list = ctx.data.initiatives.filter((i) => {
    if ((activeOnly || !ctx.approved) && i.status !== 'active') return false
    const hay = `${i.title} ${i.category} ${i.abstract}`.toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  })
  return (
    <div>
      <div className="section">
        <h1>Research catalog</h1>
        <p className="muted">
          Every active Decoded Brain initiative at UC San Diego. Anyone can read this page.
        </p>
      </div>
      <div className="row section">
        <input
          type="search" placeholder="Search initiatives" value={q}
          onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }}
        />
        {ctx.approved ? (
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Active only
          </label>
        ) : null}
      </div>
      {list.length ? (
        <div className="card-grid">
          {list.map((i) => <InitiativeCard key={i.id} ctx={ctx} ini={i} />)}
        </div>
      ) : <Empty>No initiatives match.</Empty>}
    </div>
  )
}

function ObligationRow({ ctx, ob }: { ctx: Ctx; ob: Obligation }) {
  const ini = ctx.data.initiatives.find((i) => i.id === ob.initiativeId)
  const targetDoc = ob.targetId ? ctx.data.documents.find((d) => d.id === ob.targetId) : null
  const reviewedIni = targetDoc ? ctx.data.initiatives.find((i) => i.id === targetDoc.initiativeId) : null
  const draft = ctx.data.documents.find((d) =>
    d.status === 'draft' && d.kind === ob.kind && d.authorId === ctx.userId &&
    (ob.kind === 'rm' ? d.initiativeId === ob.initiativeId : d.targetId === ob.targetId),
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
              ? `Reporting memo - ${ini?.title ?? 'initiative'}`
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
                    { initiativeId: ob.initiativeId, kind: 'rm' }, 'Draft started.')
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
            Open Labs is where Decoded Brain initiatives at UC San Diego publish their
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
    d.kind === 'rm' && d.status === 'submitted' &&
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
    <div>
      <div className="section">
        <h1>Welcome, {me.name.split(' ')[0]}</h1>
        <p className="muted">Here is what is waiting on you this week.</p>
      </div>

      <div className="section">
        <h2><Inbox size={18} /> Your reporting memos</h2>
        {myRm.length
          ? myRm.map((o) => <ObligationRow key={o.id} ctx={ctx} ob={o} />)
          : <Empty>No reporting memo due right now.</Empty>}
      </div>

      <div className="section">
        <h2><ClipboardList size={18} /> Your reviews</h2>
        {myReviews.length
          ? myReviews.map((o) => <ObligationRow key={o.id} ctx={ctx} ob={o} />)
          : <Empty>No manual reviews assigned to you.</Empty>}
      </div>

      {decisions.length ? (
        <div className="section">
          <h2><ShieldCheck size={18} /> Decisions waiting on you</h2>
          <ul>{decisions}</ul>
        </div>
      ) : null}

      {openThreads.length ? (
        <div className="section">
          <h2><MessageSquare size={18} /> Open comment threads</h2>
          {openThreads.map((t) => {
            const doc = data.documents.find((x) => x.id === t.documentId)
            return (
              <div className="card" key={t.id}>
                <div className="between">
                  <span>&ldquo;{t.quote}&rdquo;</span>
                  <a className="btn ghost sm" href={`#/document/${t.documentId}`}>Open {doc?.title}</a>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="section">
        <h2><FlaskConical size={18} /> Your initiatives</h2>
        {myInitiatives.length ? (
          <div className="card-grid">
            {myInitiatives.map((i) => <InitiativeCard key={i.id} ctx={ctx} ini={i} />)}
          </div>
        ) : <Empty>You are not on a team yet. Browse the <a href="#/catalog">catalog</a>.</Empty>}
      </div>
    </div>
  )
}

function PageInitiative({ ctx }: { ctx: Ctx }) {
  const id = ctx.route.parts[1]
  const tab = ctx.route.parts[2] ?? 'overview'
  const ini = ctx.data.initiatives.find((i) => i.id === id)
  if (!ini) return <NotFound />

  const internal = ctx.approved
  if (!internal && ini.status !== 'active') {
    return <div className="card"><h3>{ini.title}</h3><p className="muted">This initiative is not public.</p></div>
  }

  const isMember = !!ctx.userId && (ini.members.includes(ctx.userId) || ini.leadId === ctx.userId)
  const canManage = ini.leadId === ctx.userId || ctx.isAdmin
  const docs = ctx.data.documents.filter((d) => d.initiativeId === ini.id)
  const joinReqs = ctx.data.requests.filter((r) =>
    r.kind === 'join' && r.initiativeId === ini.id && r.status === 'pending')
  const myPendingJoin = ctx.data.requests.some((r) =>
    r.kind === 'join' && r.initiativeId === ini.id && r.userId === ctx.userId && r.status === 'pending')
  const activity = ctx.data.audit.filter((a) => a.detail.includes(`[${ini.id}]`))

  const tabs = internal
    ? ['overview', 'tasks', 'team', 'documents', 'activity']
    : ['overview', 'team']

  const done = ini.tasks.filter((t) => t.done).length

  return (
    <div>
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
          <h3>Abstract</h3>
          <p>{ini.abstract}</p>
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
            <span className="muted">{done}/{ini.tasks.length} done</span>
          </div>
          <div className="stack" style={{ margin: '12px 0' }}>
            {ini.tasks.length ? ini.tasks.map((t) => (
              <label key={t.id} className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox" checked={t.done} disabled={ctx.busy || !isMember}
                  onChange={() => ctx.run('toggleTask', { initiativeId: ini.id, taskId: t.id })}
                />
                <span style={{ textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
              </label>
            )) : <Empty>No tasks yet.</Empty>}
          </div>
          {canManage ? <AddTaskForm ctx={ctx} initiativeId={ini.id} /> : null}
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
                    <div className="row">
                      <strong>{p.name}</strong>
                      {ini.leadId === mid ? <Pill tone="good">lead</Pill> : null}
                      {internal ? <RoleBadges person={p} /> : null}
                    </div>
                    <div className="row">
                      {canTransfer ? (
                        <button className="btn ghost sm" disabled={ctx.busy} onClick={async () => {
                          if (window.confirm(`Transfer leadership to ${p.name}?`)) {
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
            {isMember ? (
              <button
                className="btn sm"
                disabled={ctx.busy}
                onClick={async () => {
                  const ok = await ctx.run('createDraft',
                    { initiativeId: ini.id, kind: 'rm' }, 'Draft started.')
                  if (ok) go(`#/initiative/${ini.id}/documents`)
                }}
              >
                <Plus size={15} /> Start reporting memo
              </button>
            ) : null}
          </div>
          <table className="table" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Title</th><th>Kind</th><th>Status</th><th>Version</th><th>Submitted</th></tr>
            </thead>
            <tbody>
              {docs.length ? docs.map((d) => (
                <tr key={d.id}>
                  <td><a href={`#/document/${d.id}`}>{d.title}</a></td>
                  <td>{d.kind === 'rm' ? 'reporting memo' : 'review'}</td>
                  <td><Pill tone={statusTone(d.status)}>{d.status}</Pill></td>
                  <td>v{d.version}</td>
                  <td>{fmtDate(d.submittedAt)}</td>
                </tr>
              )) : <tr><td colSpan={5} className="muted">No documents yet.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'activity' && internal ? (
        <div className="card">
          <h3>Activity</h3>
          {activity.length ? (
            <table className="table">
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</td>
                    <td>{a.actor}</td>
                    <td>{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
  return <SubmittedDoc ctx={ctx} doc={doc} ini={ini} />
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
            const { category, abstract, plan } = readProposal(r.body)
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
          const { category, abstract, plan } = readProposal(r.body)
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
  const people = [...ctx.data.people].sort((a, b) => a.name.localeCompare(b.name))
  const pending = people.filter((p) => p.status === 'pending')
  return (
    <div>
      <h1 className="section">Accounts</h1>

      <div className="section">
        <h2>Pending approval</h2>
        {pending.length ? pending.map((p) => (
          <div className="card" key={p.id}>
            <div className="between">
              <div><strong>{p.name}</strong> <span className="muted">{p.email}</span></div>
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
        <table className="table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Status</th><th>Roles</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.email}</td>
                <td><Pill tone={statusTone(p.status)}>{p.status}</Pill></td>
                <td>
                  {ctx.isOperations && p.id !== ctx.userId && p.status === 'approved' ? (
                    <div className="btn-row">
                      {['research', 'operations'].map((role) => {
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
        </table>
        {!ctx.isOperations ? (
          <p className="field-hint">Only Operations can grant or revoke roles.</p>
        ) : null}
      </div>
    </div>
  )
}

function CycleControls({ ctx }: { ctx: Ctx }) {
  const [monday, setMonday] = useState('')
  const [isBreak, setIsBreak] = useState(false)
  const [penalty, setPenalty] = useState('10')
  const [reward, setReward] = useState('4')
  if (!ctx.isResearch) return null
  return (
    <div className="section" style={{ marginTop: 20 }}>
      <h2><Clock size={18} /> Research cycle</h2>
      <div className="card">
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault()
            if (!monday) return alert('Select a Monday.')
            const date = new Date(monday)
            if (date.getUTCDay() !== 1) return alert('Please select a Monday.')
            await ctx.run('openCycle', { monday, isBreak }, 'Cycle opened.')
          }}
        >
          <Field label="Week of (Monday)">
            <input type="date" value={monday} disabled={ctx.busy}
              onChange={(e) => setMonday(e.target.value)} />
          </Field>
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={isBreak} disabled={ctx.busy}
              onChange={(e) => setIsBreak(e.target.checked)} />
            Break week
          </label>
          <button className="btn sm" disabled={ctx.busy || !monday}>Open cycle</button>
        </form>
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
  const submittedRm = ctx.data.documents.filter((d) => d.kind === 'rm' && d.status === 'submitted')
  const reviewObligations = ctx.data.obligations.filter((o) => o.kind === 'review')
  return (
    <div>
      <h1 className="section">Review assignments</h1>
      <p className="muted section">
        Research assigns each reporting memo a reviewer from outside that initiative.
      </p>

      <div className="section">
        <h2>Submitted reporting memos</h2>
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
        <table className="table">
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
        </table>
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
      <table className="table">
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
      </table>

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
      <table className="table">
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
      </table>
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

export default function App({ data, userId, onAction, mode, onSignIn, onSignOut }: AppProps) {
  const [route, setRoute] = useState<Route>(() => parseHash())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const me = userId ? data.people.find((p) => p.id === userId) ?? null : null
  const approved = me?.status === 'approved'
  const roles = me?.roles ?? []
  const isResearch = approved && roles.includes('research')
  const isOperations = approved && roles.includes('operations')
  const isAdmin = isResearch || isOperations

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

  const run = (action: string, payload: any, okMsg?: string) =>
    guard(() => onAction(action, payload), okMsg)

  const ctx: Ctx = {
    data, me, userId, approved, isResearch, isOperations, isAdmin, mode, busy, route,
    personName: (id) => data.people.find((p) => p.id === id)?.name ?? 'Unknown',
    run,
    onSignIn: (email) => guard(() => onSignIn(email), 'Check your email for a sign-in link.').then(() => undefined),
    onSignOut: () => guard(() => onSignOut()).then(() => undefined),
  }

  const leads = !!userId && data.initiatives.some((i) => i.leadId === userId)
  const unreadCount = userId ? (data.notifications || []).filter((n) => n.userId === userId && !n.readAt).length : 0
  const nav: { to: string; label: string; icon: typeof House; show: boolean }[] = [
    { to: '#/', label: 'Home', icon: House, show: true },
    { to: '#/catalog', label: 'Catalog', icon: FlaskConical, show: true },
    { to: '#/notifications', label: unreadCount ? `Inbox (${unreadCount})` : 'Inbox', icon: Bell, show: approved },
    { to: '#/proposals', label: 'Proposals', icon: Sparkles, show: approved },
    { to: '#/requests', label: 'Join requests', icon: UserPlus, show: approved && (isAdmin || leads) },
    { to: '#/assignments', label: 'Review assignments', icon: ClipboardList, show: isResearch },
    { to: '#/accounts', label: 'Accounts', icon: ShieldCheck, show: isAdmin },
    { to: '#/health', label: 'Health', icon: HeartPulse, show: approved },
    { to: '#/audit', label: 'Audit', icon: Clock, show: approved },
  ]

  function render(): ReactNode {
    if (GUARDED.has(route.name) && !approved) return <AccessNeeded ctx={ctx} />
    if (route.name === 'accounts' && !ctx.isAdmin) return <NotFound />
    if (route.name === 'assignments' && !ctx.isResearch) return <NotFound />
    switch (route.name) {
      case '': return <PageHome ctx={ctx} />
      case 'catalog': return <PageCatalog ctx={ctx} />
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

  const narrow = route.name === 'new-proposal'

  return (
    <div className="ol">
      <Sidebar nav={nav} route={route} mode={mode} />
      <div className="ol-main">
        <TopBar ctx={ctx} />
        <div className={`ol-page ${narrow ? 'ol-page-narrow' : ''}`}>{render()}</div>
      </div>
      <Toasts
        error={error} notice={notice}
        onClear={() => { setError(null); setNotice(null) }}
      />
      {busy ? <div className="ol-busy" aria-hidden="true" /> : null}
    </div>
  )
}
