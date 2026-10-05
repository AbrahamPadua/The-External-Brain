// Read-only hosted schema check using the same public key as the frontend.
// Never prints configuration values and never creates accounts or submissions.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const config = {...process.env}
try {
  for(const line of readFileSync(new URL('../.env.local',import.meta.url),'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)
    if(match && !config[match[1]])config[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2')
  }
} catch { /* CI may supply environment variables instead */ }
const base = config.VITE_SUPABASE_URL
const key = config.VITE_SUPABASE_ANON_KEY
assert.ok(base && key,'Frontend Supabase configuration is required')
const endpoint = new URL(base)
assert.ok(endpoint.protocol==='https:' && !endpoint.username && !endpoint.password,'Use the HTTPS project base URL')
if(!key.startsWith('sb_publishable_')) {
  const parts=key.split('.')
  assert.equal(parts.length,3,'Use a frontend publishable or anon key')
  assert.equal(JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role,'anon','Use the frontend anon key')
}
const headers={apikey:key,...(!key.startsWith('sb_publishable_')?{Authorization:`Bearer ${key}`}:{})}
async function publicRead(table,columns) {
  const response=await fetch(`${base}/rest/v1/${table}?select=${columns}&limit=1`,{headers})
  assert.equal(response.status,200,`${table} expected publicly readable columns (HTTP ${response.status})`)
  return response.json()
}
await publicRead('initiative_catalog','id,execution_plan,project_idea_id,proposer_id,proposer_name')
const references=await fetch(`${base}/rest/v1/initiative_catalog?select=id&project_idea_id=not.is.null&limit=1`,{headers})
assert.equal(references.status,200,'Public initiatives must remain readable')
assert.deepEqual(await references.json(),[],'Visitors must not receive original idea references')
for(const [table,columns] of [['project_idea_catalog','id,title,summary,execution_plan,motivation'],['idea_lead_requests','id,message']]) {
  const response=await fetch(`${base}/rest/v1/${table}?select=${columns}&limit=1`,{headers})
  assert.ok([401,403].includes(response.status),`${table} must deny anonymous reads (HTTP ${response.status}); apply migration 027`)
  assert.equal((await response.json()).code,'42501',`${table} must deny access rather than merely have no rows`)
}
// Supabase's existing default table grants may allow SELECT while proposal RLS
// filters every row. Both an explicit privilege denial and no rows are private.
const proposals=await fetch(`${base}/rest/v1/proposals?select=id,content,decision_reason&limit=1`,{headers})
assert.ok([200,401,403].includes(proposals.status),'Raw proposal privacy check failed')
if(proposals.status===200)assert.deepEqual(await proposals.json(),[],'Raw proposals and review feedback must remain private')
else assert.equal((await proposals.json()).code,'42501','Raw proposals must deny access')
console.log('PASS (hosted, read-only): public initiatives readable without original idea references; migration 027 denies anonymous project ideas and applicant notes; raw proposals remain private.')
