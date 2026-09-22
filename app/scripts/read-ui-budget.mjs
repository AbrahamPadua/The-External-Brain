// Read the same account allowance exposed by /status; never redeem resets.
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const child = spawn('codex', ['app-server', '--stdio'], {
  windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
})
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1 }, 25000)
const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)
child.on('error', (error) => { console.error(error.message); clearTimeout(timeout); process.exitCode = 1 })
createInterface({ input: child.stdout }).on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.id === 1) {
    if (message.error) { console.error(JSON.stringify(message.error)); child.kill(); clearTimeout(timeout); process.exitCode = 1; return }
    send({ method: 'initialized', params: {} })
    send({ id: 2, method: 'account/rateLimits/read' })
  }
  if (message.id === 2) {
    if (message.error) { console.error(JSON.stringify(message.error)); process.exitCode = 1 }
    else {
      const result = message.result
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), rateLimits: result.rateLimits, rateLimitsByLimitId: result.rateLimitsByLimitId }, null, 2))
    }
    child.kill(); clearTimeout(timeout)
  }
})
send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'openlabs-budget-check', version: '1.0' } } })
