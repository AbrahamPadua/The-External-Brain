// Read-only reconciliation of a captured Notion manifest. Never mutates Notion,
// never downloads, and never maps unseen source data: it only checks that a
// snapshot is internally consistent and fully retained so a human can map it.
import {readFileSync, realpathSync, statSync} from 'node:fs'
import {dirname, resolve, isAbsolute, sep} from 'node:path'

const KINDS = ['initiative', 'rm', 'review', 'thread', 'comment', 'attachment', 'person']
// Null-prototype: a record kind of "constructor"/"__proto__"/"toString" must miss
// here, not resolve to an inherited member and throw on rule.includes(...).
const PARENT_OK = Object.assign(Object.create(null), {
  rm: ['initiative'],
  review: ['rm'],
  thread: ['rm', 'review'],
  comment: ['thread', 'comment'],
  attachment: ['initiative', 'rm', 'review', 'thread', 'comment'],
})
const NO_PARENT = ['initiative', 'person']
const AUTHORED = ['rm', 'review', 'comment']

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/check-import.mjs <private-manifest.json>')
  process.exit(1)
}

function emit(report, code) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(code)
}
function isHttpUrl(v) {
  if (typeof v !== 'string') return false
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

// --- fail closed on an unreadable or non-object manifest --------------------
let manifest
try {
  manifest = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  emit({status: 'BLOCKED', counts: {}, warnings: [], unresolved: [],
        errors: [`Unreadable or malformed manifest JSON: ${e.message}`]}, 1)
}
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  emit({status: 'BLOCKED', counts: {}, warnings: [], unresolved: [],
        errors: ['Manifest must be a JSON object']}, 1)
}

const errors = [], warnings = [], unresolved = [], counts = Object.create(null), ids = new Map()
const records = Array.isArray(manifest.records) ? manifest.records : null
if (!records) errors.push('Manifest "records" must be an array')
const rows = records ?? []

const baseDir = resolve(dirname(file))
let realBase
try {
  realBase = realpathSync(baseDir)
} catch {
  realBase = baseDir
}

// A retained attachment must be a real regular file that stays inside the
// manifest's own directory. A durableUrl is recorded context, never proof.
function retainedError(r) {
  const lp = r.localPath
  if (typeof lp !== 'string' || !lp.trim())
    return `Attachment not retained — a verifiable local file copy is required; durableUrl alone is not: ${r.sourceId}`
  if (isAbsolute(lp))
    return `Attachment localPath must be relative to the manifest directory: ${r.sourceId}`
  const target = resolve(baseDir, lp)
  if (target !== baseDir && !target.startsWith(baseDir + sep))
    return `Attachment localPath escapes the manifest directory: ${r.sourceId}`
  let real
  try {
    real = realpathSync(target)
  } catch {
    return `Attachment file is missing: ${r.sourceId} (${lp})`
  }
  if (real !== realBase && !real.startsWith(realBase + sep))
    return `Attachment resolves outside the manifest directory via a symlink: ${r.sourceId}`
  let st
  try {
    st = statSync(real)
  } catch {
    return `Attachment file is missing: ${r.sourceId} (${lp})`
  }
  if (!st.isFile())
    return `Attachment localPath is not a regular file: ${r.sourceId} (${lp})`
  return null
}

// --- pass 1: per-record shape, identity, counts, retention -----------------
for (const [i, r] of rows.entries()) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    errors.push(`Record #${i} is not an object`)
    continue
  }
  if (typeof r.kind === 'string' && KINDS.includes(r.kind)) counts[r.kind] = (counts[r.kind] ?? 0) + 1
  else errors.push(`Record #${i} has an unsupported kind: ${JSON.stringify(r.kind)}`)
  if (typeof r.sourceId !== 'string' || !r.sourceId.trim()) {
    errors.push(`Record #${i} requires a non-empty string sourceId`)
    continue
  }
  if (ids.has(r.sourceId)) errors.push(`Duplicate sourceId: ${r.sourceId}`)
  else ids.set(r.sourceId, r)
  if (!isHttpUrl(r.sourceUrl)) errors.push(`Record ${r.sourceId} requires a valid http(s) sourceUrl`)
  if (r.complete !== true) errors.push(`Incomplete capture (complete !== true): ${r.sourceId}`)
  if (r.parentSourceId != null && typeof r.parentSourceId !== 'string')
    errors.push(`parentSourceId must be a string: ${r.sourceId}`)
  if (r.authorSourceId != null && typeof r.authorSourceId !== 'string')
    errors.push(`authorSourceId must be a string: ${r.sourceId}`)
  if (r.durableUrl != null && !isHttpUrl(r.durableUrl))
    warnings.push(`durableUrl is not a valid http(s) URL: ${r.sourceId}`)
  if (r.kind === 'thread') {
    if (r.quote != null && (typeof r.quote !== 'string' || !r.quote.trim()))
      errors.push(`thread quote must be a non-empty string when present: ${r.sourceId}`)
    if (r.blockSourceId != null && (typeof r.blockSourceId !== 'string' || !r.blockSourceId.trim()))
      errors.push(`thread blockSourceId must be a non-empty string when present: ${r.sourceId}`)
  }
  if (r.kind === 'attachment') {
    const m = retainedError(r)
    if (m) errors.push(m)
  }
}

// --- pass 2: relationships, parent/author kinds, thread anchors ------------
for (const r of rows) {
  if (!r || typeof r !== 'object' || typeof r.sourceId !== 'string') continue
  if (!KINDS.includes(r.kind)) continue // unsupported kind already reported in pass 1
  const rule = PARENT_OK[r.kind]
  if (NO_PARENT.includes(r.kind) && r.parentSourceId != null)
    errors.push(`${r.kind} must not have a parent: ${r.sourceId}`)
  if (rule) {
    if (r.parentSourceId == null) {
      errors.push(`Missing parent: ${r.sourceId}`)
    } else {
      const p = ids.get(r.parentSourceId)
      if (!p) errors.push(`Unresolved parent: ${r.sourceId} -> ${r.parentSourceId}`)
      else if (typeof p.kind === 'string' && !rule.includes(p.kind))
        errors.push(`${r.kind} has an invalid parent kind ${p.kind}; expected ${rule.join('/')}: ${r.sourceId}`)
    }
  }
  if (AUTHORED.includes(r.kind)) {
    if (r.authorSourceId != null) {
      const a = ids.get(r.authorSourceId)
      if (!a) errors.push(`Author record not found: ${r.sourceId} -> ${r.authorSourceId}`)
      else if (a.kind !== 'person')
        errors.push(`Author must reference a person record (got ${a.kind}): ${r.sourceId}`)
    } else if (r.authorUnresolved === true) {
      unresolved.push({sourceId: r.sourceId, kind: r.kind, issue: 'author-unresolved'})
    } else {
      errors.push(`Missing author and no explicit authorUnresolved flag: ${r.sourceId}`)
    }
  }
  if (r.kind === 'thread') {
    const hasAnchor =
      (typeof r.quote === 'string' && r.quote.trim() !== '') ||
      (typeof r.blockSourceId === 'string' && r.blockSourceId.trim() !== '')
    if (!hasAnchor) {
      if (r.anchorUnresolved === true)
        unresolved.push({sourceId: r.sourceId, kind: 'thread', issue: 'anchor-unresolved'})
      else
        errors.push(`Thread has no recoverable anchor and no explicit anchorUnresolved flag: ${r.sourceId}`)
    }
  }
}

// --- parent cycles -------------------------------------------------------
const inCycle = new Set()
for (const r of rows) {
  if (!r || typeof r.sourceId !== 'string' || r.parentSourceId == null || inCycle.has(r.sourceId)) continue
  const seen = new Set()
  let cur = r, hops = 0
  while (cur && typeof cur.sourceId === 'string') {
    if (seen.has(cur.sourceId)) {
      for (const id of seen) inCycle.add(id)
      errors.push(`Parent cycle detected involving: ${[...seen].join(' -> ')}`)
      break
    }
    seen.add(cur.sourceId)
    if (cur.parentSourceId == null) break
    cur = ids.get(cur.parentSourceId)
    if (++hops > rows.length + 2) break
  }
}

// --- inventory: expectedCounts must declare every supported kind, 0 included -
const ec = manifest.expectedCounts
if (!ec || typeof ec !== 'object' || Array.isArray(ec)) {
  errors.push('expectedCounts inventory is required and must be an object of kind -> non-negative integer')
} else {
  for (const [k, v] of Object.entries(ec)) {
    if (!KINDS.includes(k)) errors.push(`expectedCounts has an unknown kind: ${k}`)
    if (!Number.isInteger(v) || v < 0) errors.push(`expectedCounts.${k} must be a non-negative integer`)
  }
  // Require an explicit entry per supported kind so a kind that was never
  // captured and also left out of the inventory (e.g. comments or attachments
  // omitted entirely) is still caught rather than silently passing.
  for (const k of KINDS)
    if (!Object.hasOwn(ec, k))
      errors.push(`expectedCounts is missing a required kind: ${k} (declare 0 if none were captured)`)
  for (const [k, v] of Object.entries(ec))
    if (Number.isInteger(v) && (counts[k] ?? 0) !== v)
      errors.push(`${k}: expected ${v}, captured ${counts[k] ?? 0}`)
}

// --- top-level provenance ----------------------------------------------
if (typeof manifest.capturedAt !== 'string' || Number.isNaN(Date.parse(manifest.capturedAt)))
  errors.push('capturedAt must be an ISO-8601 timestamp string')
if (typeof manifest.sourceWorkspace !== 'string' || !manifest.sourceWorkspace.trim())
  errors.push('sourceWorkspace is required')
if (records && !rows.length) errors.push('No records captured')

const status = errors.length
  ? 'BLOCKED'
  : unresolved.length
    ? 'READY_WITH_UNRESOLVED'
    : 'READY_FOR_MAPPING'
console.log(JSON.stringify({status, counts, warnings, unresolved, errors}, null, 2))
process.exitCode = errors.length ? 1 : 0
