// Stop hook: Claude can't finish a turn while the build or the affected tests fail.
// Runs only when app or migration files changed since the last passing check.
// Gives up after 3 blocked attempts in a row so a broken check can't trap the session.
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const app = join(root, 'app')
const MAX_BLOCKS = 3

let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch {}
const session = String(input.session_id || 'default').replace(/[^\w-]/g, '')
const stateFile = join(tmpdir(), `teb-verify-${session}.json`)
let state = { passed: '', blocks: 0 }
try { if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, 'utf8')) } catch {}
const save = () => writeFileSync(stateFile, JSON.stringify(state))

const git = args => execSync(`git ${args}`, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
const entries = git('status --porcelain --untracked-files=all').split('\n').filter(Boolean)
  .map(line => ({ untracked: line.startsWith('??'), path: line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '') }))
const relevant = entries.filter(e => /^(app\/(src|scripts|index\.html|package(-lock)?\.json|tsconfig|vite\.config)|supabase\/migrations\/)/.test(e.path))
if (!relevant.length) process.exit(0)

const hash = createHash('sha1').update(git('diff HEAD --binary'))
for (const e of relevant.filter(e => e.untracked)) {
  hash.update(e.path)
  try { hash.update(readFileSync(join(root, e.path))) } catch {}
}
const fingerprint = hash.digest('hex')
if (fingerprint === state.passed) process.exit(0)

const run = (label, command, cwd) => {
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return r.status === 0 ? null : `${label} failed (${command}):\n${`${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-60).join('\n')}`
}
const failures = [run('Build and typecheck', 'npm run build', app)]
if (relevant.some(e => e.path.startsWith('app/'))) failures.push(run('Affected tests', 'npx vitest run src --changed --passWithNoTests', app))
if (relevant.some(e => e.path.startsWith('supabase/migrations/') || e.path === 'app/scripts/check-database.mjs')) {
  failures.push(run('Database and RLS check', 'node scripts/check-database.mjs', app))
}
const failed = failures.filter(Boolean)

if (!failed.length) {
  state = { passed: fingerprint, blocks: 0 }
  save()
  process.exit(0)
}
state.blocks += 1
save()
if (state.blocks > MAX_BLOCKS) {
  state.blocks = 0
  save()
  console.log(JSON.stringify({ systemMessage: `Verification still failing after ${MAX_BLOCKS} attempts. Claude was allowed to stop; check the build and tests yourself.` }))
  process.exit(0)
}
console.error(`Verification failed. Fix the cause (never delete or weaken a test to pass), then finish.\n\n${failed.join('\n\n')}`)
process.exit(2)
