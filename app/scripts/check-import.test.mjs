// Synthetic checks for scripts/check-import.mjs. Essential failure modes only:
// manifest corruption, missing inventory, attachment path/symlink escape,
// unretained attachments, broken relationships and cycles must all block; a
// clean fixture and an explicitly-unresolved fixture must pass.
// Run from app/:  node scripts/check-import.test.mjs
import {strict as assert} from 'node:assert'
import {mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-import.mjs')
const root = mkdtempSync(join(tmpdir(), 'check-import-'))
let caseNo = 0

function run(manifest, {raw, files = {}, prepare} = {}) {
  const dir = join(root, `case-${++caseNo}`)
  mkdirSync(join(dir, 'files'), {recursive: true})
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel)
    mkdirSync(dirname(p), {recursive: true})
    writeFileSync(p, body)
  }
  if (prepare) prepare(dir)
  const mp = join(dir, 'manifest.json')
  writeFileSync(mp, raw !== undefined ? raw : JSON.stringify(manifest))
  const res = spawnSync(process.execPath, [SCRIPT, mp], {encoding: 'utf8'})
  let report = null
  try {
    report = JSON.parse(res.stdout)
  } catch {
    /* leave report null on non-JSON output */
  }
  return {code: res.status, report, stdout: res.stdout, stderr: res.stderr}
}

function base() {
  return {
    capturedAt: '2026-09-01T00:00:00Z',
    sourceWorkspace: 'ucsd-open-labs',
    expectedCounts: {initiative: 1, person: 1, rm: 1, review: 1, thread: 1, comment: 1, attachment: 1},
    records: [
      {kind: 'initiative', sourceId: 'i1', sourceUrl: 'https://notion.so/i1', complete: true},
      {kind: 'person', sourceId: 'p1', sourceUrl: 'https://notion.so/p1', complete: true},
      {kind: 'rm', sourceId: 'rm1', sourceUrl: 'https://notion.so/rm1', complete: true, parentSourceId: 'i1', authorSourceId: 'p1'},
      {kind: 'review', sourceId: 'rv1', sourceUrl: 'https://notion.so/rv1', complete: true, parentSourceId: 'rm1', authorSourceId: 'p1'},
      {kind: 'thread', sourceId: 't1', sourceUrl: 'https://notion.so/t1', complete: true, parentSourceId: 'rm1', quote: 'anchored text'},
      {kind: 'comment', sourceId: 'c1', sourceUrl: 'https://notion.so/c1', complete: true, parentSourceId: 't1', authorSourceId: 'p1'},
      {kind: 'attachment', sourceId: 'a1', sourceUrl: 'https://notion.so/a1', complete: true, parentSourceId: 'rm1', localPath: 'files/a1.bin'},
    ],
  }
}
const withAttachment = {files: {'files/a1.bin': 'binary'}}
const att = m => m.records.find(r => r.kind === 'attachment')

let failures = 0, skips = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
  } catch (e) {
    failures++
    console.log(`  FAIL  ${name}: ${e.message}`)
  }
}

check('clean fixture is READY_FOR_MAPPING (exit 0)', () => {
  const {report, code} = run(base(), withAttachment)
  assert.equal(report.status, 'READY_FOR_MAPPING')
  assert.equal(code, 0)
})

check('malformed manifest JSON fails closed', () => {
  const {report, code} = run(null, {raw: '{ this is not json'})
  assert.equal(report.status, 'BLOCKED')
  assert.equal(code, 1)
})

check('missing expectedCounts inventory blocks', () => {
  const m = base()
  delete m.expectedCounts
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /expectedCounts/i.test(e)))
})

check('a captured kind absent from expectedCounts blocks', () => {
  const m = base()
  delete m.expectedCounts.attachment
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /missing a required kind: attachment/i.test(e)))
})

check('a kind omitted from BOTH records and expectedCounts still blocks', () => {
  const m = base()
  m.records = m.records.filter(r => r.kind !== 'comment') // nothing captured
  delete m.expectedCounts.comment // and the inventory quietly leaves it out
  const {report, code} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.equal(code, 1)
  assert.ok(report.errors.some(e => /missing a required kind: comment/i.test(e)))
})

check('a prototype-key record kind is rejected without crashing', () => {
  const m = base()
  m.records.push({kind: 'constructor', sourceId: 'evil1', sourceUrl: 'https://notion.so/evil1', complete: true, parentSourceId: 'i1'})
  const {report, code} = run(m, withAttachment)
  assert.ok(report, 'a JSON report was emitted (no uncaught TypeError)')
  assert.equal(report.status, 'BLOCKED')
  assert.equal(code, 1)
  assert.ok(report.errors.some(e => /unsupported kind/i.test(e)))
})

check('a non-string quote does not count as a recovered anchor', () => {
  const m = base()
  m.records.find(r => r.kind === 'thread').quote = {} // object must not satisfy the anchor
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /anchor|quote/i.test(e)))
})

check('expectedCounts mismatch blocks', () => {
  const m = base()
  m.expectedCounts.rm = 2
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /expected 2, captured 1/.test(e)))
})

check('non-http sourceUrl blocks', () => {
  const m = base()
  m.records[2].sourceUrl = 'notion-page-rm1'
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /sourceUrl/.test(e)))
})

check('wrong parent kind blocks', () => {
  const m = base()
  m.records[3].parentSourceId = 'i1' // review -> initiative
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /invalid parent kind/i.test(e)))
})

check('parent cycle blocks', () => {
  const m = base()
  m.records.push(
    {kind: 'comment', sourceId: 'x1', sourceUrl: 'https://notion.so/x1', complete: true, parentSourceId: 'x2', authorSourceId: 'p1'},
    {kind: 'comment', sourceId: 'x2', sourceUrl: 'https://notion.so/x2', complete: true, parentSourceId: 'x1', authorSourceId: 'p1'},
  )
  m.expectedCounts.comment = 3
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /cycle/i.test(e)))
})

check('author that is not a person record blocks', () => {
  const m = base()
  m.records[2].authorSourceId = 'i1'
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /person record/i.test(e)))
})

check('missing author with no explicit flag blocks', () => {
  const m = base()
  delete m.records[2].authorSourceId
  const {report} = run(m, withAttachment)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /authorUnresolved/.test(e)))
})

check('attachment with only a durableUrl blocks', () => {
  const m = base()
  delete att(m).localPath
  att(m).durableUrl = 'https://files.example/x'
  const {report} = run(m)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /not retained/i.test(e)))
})

check('attachment localPath missing on disk blocks', () => {
  const m = base()
  att(m).localPath = 'files/absent.bin'
  const {report} = run(m)
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /missing/i.test(e)))
})

check('attachment path escaping the manifest directory blocks', () => {
  const m = base()
  att(m).localPath = '../outside.bin'
  const {report} = run(m, {prepare: dir => writeFileSync(join(dir, '..', 'outside.bin'), 'x')})
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /escapes the manifest directory/i.test(e)))
})

check('attachment symlink leaving the manifest directory blocks', () => {
  const secret = join(root, 'outside-secret.bin')
  writeFileSync(secret, 'secret')
  const m = base()
  att(m).localPath = 'files/link.bin'
  let linked = false
  const {report} = run(m, {
    prepare: dir => {
      try {
        symlinkSync(secret, join(dir, 'files', 'link.bin'))
        linked = true
      } catch {
        /* host does not permit symlink creation */
      }
    },
  })
  if (!linked) {
    skips++
    console.log('        (skipped: symlinks not permitted on this host)')
    return
  }
  assert.equal(report.status, 'BLOCKED')
  assert.ok(report.errors.some(e => /symlink/i.test(e)))
})

check('explicit authorUnresolved / anchorUnresolved yields READY_WITH_UNRESOLVED', () => {
  const m = base()
  delete m.records[2].authorSourceId
  m.records[2].authorUnresolved = true
  delete m.records[4].quote
  m.records[4].anchorUnresolved = true
  const {report, code} = run(m, withAttachment)
  assert.equal(report.status, 'READY_WITH_UNRESOLVED')
  assert.equal(code, 0)
  assert.equal(report.unresolved.length, 2)
})

rmSync(root, {recursive: true, force: true})
if (failures) {
  console.log(`FAIL: ${failures} case(s) did not behave as specified.`)
  process.exit(1)
}
console.log(`PASS: check-import gate — ${caseNo - skips} fixtures verified${skips ? `, ${skips} skipped` : ''}.`)
