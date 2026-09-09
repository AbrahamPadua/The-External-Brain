// Read-only reconciliation of a captured Notion manifest. Never mutates Notion.
import {readFileSync} from 'node:fs'
const file=process.argv[2]
if(!file){console.error('Usage: node scripts/check-import.mjs <private-manifest.json>');process.exit(1)}
const manifest=JSON.parse(readFileSync(file,'utf8'))
const errors=[],warnings=[],ids=new Map(),counts={}
const records=manifest.records??[]
for(const r of records){
 counts[r.kind]=(counts[r.kind]??0)+1
 if(!r.sourceId||!r.sourceUrl)errors.push('Every record requires sourceId and sourceUrl')
 if(ids.has(r.sourceId))errors.push(`Duplicate sourceId: ${r.sourceId}`)
 ids.set(r.sourceId,r)
 if(!['initiative','rm','review','thread','comment','attachment','person'].includes(r.kind))errors.push(`Unsupported kind: ${r.kind}`)
 if(r.complete!==true)errors.push(`Incomplete capture: ${r.sourceId}`)
 if(['rm','review','comment'].includes(r.kind)&&!r.authorSourceId)warnings.push(`Unresolved historical author: ${r.sourceId}`)
 if(r.kind==='attachment'&&!r.localPath&&!r.durableUrl)errors.push(`Attachment not retained: ${r.sourceId}`)
}
for(const r of records){
 if(['rm','review','thread','comment','attachment'].includes(r.kind)&&!r.parentSourceId)errors.push(`Missing parent: ${r.sourceId}`)
 if(r.parentSourceId&&!ids.has(r.parentSourceId))errors.push(`Unresolved parent: ${r.sourceId} -> ${r.parentSourceId}`)
 if(r.authorSourceId&&!ids.has(r.authorSourceId))warnings.push(`Missing person record: ${r.authorSourceId}`)
 if(r.kind==='review'&&r.parentSourceId&&ids.get(r.parentSourceId)?.kind!=='rm')errors.push(`Review must link to an RM: ${r.sourceId}`)
 if(r.kind==='thread'&&!r.quote&&!r.blockSourceId)warnings.push(`Thread has no recoverable anchor: ${r.sourceId}`)
}
for(const [kind,expected] of Object.entries(manifest.expectedCounts??{})){if((counts[kind]??0)!==expected)errors.push(`${kind}: expected ${expected}, captured ${counts[kind]??0}`)}
if(!manifest.capturedAt||!manifest.sourceWorkspace)errors.push('Capture timestamp and source workspace are required')
if(!records.length)errors.push('No records captured')
console.log(JSON.stringify({status:errors.length?'BLOCKED':'READY_FOR_MAPPING',counts,warnings,errors},null,2))
process.exitCode=errors.length?1:0
