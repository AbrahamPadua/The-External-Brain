// Offline validation of the Pages prebuild guard in .github/workflows/pages.yml.
//
// It extracts the real Node heredoc from the workflow (no copy of the logic lives
// here) and runs it exactly as the workflow does: piped to `node -` with the two
// VITE variables supplied through an isolated environment. Every credential below is
// a synthetic fixture; nothing reads .env, real project settings or the network.
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const workflow = new URL('../../.github/workflows/pages.yml', import.meta.url)

/** Reproduce YAML block-scalar stripping + bash heredoc: the guard script verbatim. */
function extractGuard() {
  const lines = readFileSync(workflow, 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => l.trim() === "node - <<'NODE'")
  if (start === -1) throw new Error('pages.yml: could not find the guard heredoc')
  const indent = lines[start].length - lines[start].trimStart().length
  const body = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].slice(indent)
    if (line.trim() === 'NODE' && lines[i].length - lines[i].trimStart().length === indent) {
      return body.join('\n')
    }
    body.push(line)
  }
  throw new Error('pages.yml: unterminated guard heredoc')
}

const b64 = (value) => Buffer.from(value).toString('base64url')
const jwt = (payload) =>
  `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${payload}.FIXTURESIGNATURE`
const claims = (role) =>
  b64(JSON.stringify({ iss: 'supabase', ref: 'fixtureref', role, exp: 4102444800 }))

// --- synthetic fixtures (not credentials: invented strings, no live project) ---
const URL_OK = 'https://fixtureproject.supabase.co'
const URL_USERINFO = 'https://fixtureuser:FIXTUREPASSWORDSENTINEL@fixtureproject.supabase.co'
const PUBLISHABLE_OK = 'sb_publishable_FIXTUREPUBLISHABLEKEY0001'
const ANON_CLAIMS = claims('anon')
const SERVICE_CLAIMS = claims('service_role')
const ANON_JWT = jwt(ANON_CLAIMS)
const SERVICE_JWT = jwt(SERVICE_CLAIMS)
const NULL_JWT = jwt(b64('null'))
const SECRET_KEY = 'sb_secret_FIXTURESENTINEL0000000001'

// Anything here must never reach the guard's output, in any case, pass or fail.
const SENSITIVE = [
  PUBLISHABLE_OK, ANON_JWT, SERVICE_JWT, NULL_JWT, SECRET_KEY,
  ANON_CLAIMS, SERVICE_CLAIMS, 'FIXTURESENTINEL', 'FIXTUREPASSWORDSENTINEL',
]

const cases = [
  { name: 'publishable key accepted', url: URL_OK, key: PUBLISHABLE_OK, code: 0,
    expect: ['Supabase configuration accepted', 'publishable (sb_publishable_)'] },
  { name: 'legacy anon JWT accepted', url: URL_OK, key: ANON_JWT, code: 0,
    expect: ['Supabase configuration accepted', 'legacy anon JWT'] },
  { name: 'missing values rejected', url: '', key: '', code: 1,
    expect: ['VITE_SUPABASE_URL is empty or unset', 'VITE_SUPABASE_ANON_KEY is empty or unset'] },
  { name: 'service_role JWT rejected', url: URL_OK, key: SERVICE_JWT, code: 1,
    expect: ['role claim is not "anon"'] },
  { name: 'null payload JWT rejected', url: URL_OK, key: NULL_JWT, code: 1,
    expect: ['not a decodable JSON object'] },
  { name: 'secret key rejected', url: URL_OK, key: SECRET_KEY, code: 1,
    expect: ['is a secret key (sb_secret_)'] },
  { name: 'URL userinfo rejected', url: URL_USERINFO, key: PUBLISHABLE_OK, code: 1,
    expect: ['must not embed credentials'] },
]

const guard = extractGuard()
if (!guard.includes('VITE_SUPABASE_ANON_KEY') || guard.length < 500) {
  throw new Error('pages.yml: extracted guard looks wrong')
}
console.log(`Extracted guard from pages.yml: ${guard.split('\n').length} lines, ${guard.length} chars.`)

// Isolated environment: nothing ambient is inherited, so no real VITE_* can leak in.
const baseEnv = { PATH: process.env.PATH ?? '' }
for (const k of ['SystemRoot', 'SYSTEMROOT', 'ComSpec']) if (process.env[k]) baseEnv[k] = process.env[k]

const redact = (text) => SENSITIVE.reduce((t, s) => t.split(s).join('[REDACTED]'), text)
let failures = 0

for (const c of cases) {
  const run = spawnSync(process.execPath, ['-'], {
    input: guard,
    encoding: 'utf8',
    env: { ...baseEnv, VITE_SUPABASE_URL: c.url, VITE_SUPABASE_ANON_KEY: c.key },
  })
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  const problems = []
  if (run.error) problems.push(`spawn failed: ${run.error.message}`)
  if (run.status !== c.code) problems.push(`exit ${run.status}, expected ${c.code}`)
  for (const needle of c.expect) if (!out.includes(needle)) problems.push(`missing message: ${needle}`)
  for (const secret of SENSITIVE) if (out.includes(secret)) problems.push('fixture credential leaked into output')
  if (problems.length === 0) {
    console.log(`  PASS  ${c.name} (exit ${run.status})`)
  } else {
    failures += 1
    console.log(`  FAIL  ${c.name}: ${problems.join('; ')}`)
    console.log(redact(out).split('\n').map((l) => `        | ${l}`).join('\n'))
  }
}

if (failures > 0) {
  console.log(`FAIL: ${failures} of ${cases.length} guard cases did not behave as specified.`)
  process.exit(1)
}
console.log(`PASS: ${cases.length} guard cases - accepts publishable and legacy anon keys, rejects missing values,`)
console.log('      service_role and null-payload JWTs, secret keys and URL userinfo, and never echoes a key.')
