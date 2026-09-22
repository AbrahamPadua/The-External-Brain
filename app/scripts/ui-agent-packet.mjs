// Bounded, text-only AGY packet. No agent filesystem or shell permissions needed.
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const [promptPath, resultPath, ...contextPaths] = process.argv.slice(2)
if (!promptPath || !resultPath) throw new Error('Expected prompt file, result file, then context files')
const prompt = [readFileSync(promptPath, 'utf8'), ...contextPaths.map(path => `${path}:\n${readFileSync(path, 'utf8')}`)].join('\n\n')
const agent = spawn('agy', ['--model', 'gemini-3.8-flash-high', '--effort', 'high', '--mode', 'plan', '--print-timeout', '120s', '--print', prompt], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let result = ''
agent.stdout.on('data', chunk => { result += chunk })
agent.stderr.on('data', chunk => process.stderr.write(chunk))
agent.on('error', error => { console.error(error.message); process.exitCode = 1 })
agent.on('close', code => { writeFileSync(resultPath, result); console.log(`AGY exit ${code}; saved ${result.length} characters to ${resultPath}`); process.exitCode = code ?? 1 })
