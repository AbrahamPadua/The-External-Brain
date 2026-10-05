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
await publicRead('project_idea_catalog','id,title,summary,category,execution_plan,motivation,proposer_id,proposer_name,initiative_id')
const privateResponse=await fetch(`${base}/rest/v1/idea_lead_requests?select=id,message&limit=1`,{headers})
assert.ok([401,403].includes(privateResponse.status),'Applicant notes must not be publicly readable')
console.log('PASS (hosted, read-only): migrations 025/026 catalog columns accessible to visitors; applicant notes denied to anonymous callers.')
