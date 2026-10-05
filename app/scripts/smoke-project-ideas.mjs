// Browser smoke test against the local fictional fixture. No hosted mutations.
// Start Vite on 127.0.0.1:5174, then run node scripts/smoke-project-ideas.mjs.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const evidence = join(tmpdir(),'openlabs-project-ideas-smoke')
mkdirSync(evidence,{recursive:true})
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0',`--user-data-dir=${mkdtempSync(join(tmpdir(),'openlabs-ideas-browser-'))}`,
],{windowsHide:true,stdio:['ignore','ignore','pipe']})
let socket
try {
  const browserUrl = await new Promise((resolve,reject) => {
    const timer = setTimeout(()=>reject(new Error('Chrome startup timed out')),15000)
    chrome.once('error',error=>{clearTimeout(timer);reject(error)})
    chrome.stderr.on('data',chunk=>{const match=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1])}})
  })
  const origin = new URL(browserUrl).origin.replace('ws:','http:')
  const target = await (await fetch(`${origin}/json/new?about:blank`,{method:'PUT'})).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
  let seq=0
  const waiting = new Map()
  const errors = []
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data)
    if(message.id){const pending=waiting.get(message.id);waiting.delete(message.id);if(message.error)pending?.reject(new Error(JSON.stringify(message.error)));else pending?.resolve(message.result)}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text)
  })
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value}
  const waitFor=condition=>evaluate(`new Promise((resolve,reject)=>{let n=0;const check=()=>{if(${condition})resolve(true);else if(++n>100)reject(new Error('Timed out waiting for UI'));else setTimeout(check,50)};check()})`)
  const click=async text=>{await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)throw new Error('Button missing or disabled: '+${JSON.stringify(text)});b.click()})()`)}
  const navigate=async path=>{await evaluate(`location.hash=${JSON.stringify('#/'+path)}`);await waitFor(`location.hash===${JSON.stringify('#/'+path)} && document.querySelector('.ol-page')`)}
  const switchUser=async user=>{
    await navigate('settings')
    await waitFor(`document.querySelector('select')?.value!==undefined`)
    await evaluate(`(()=>{const s=[...document.querySelectorAll('label.field')].find(l=>l.textContent.includes('View the demo as')).querySelector('select');s.value=${JSON.stringify(user)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
    await waitFor(`!document.querySelector('select')?.disabled`)
    await navigate('')
    await waitFor(`document.querySelector('.dashboard') || ${JSON.stringify(user)}===''`)
  }
  const fill=async(label,value)=>evaluate(`(()=>{const l=[...document.querySelectorAll('label.field')].find(l=>l.querySelector('.field-label')?.textContent===${JSON.stringify(label)});const e=l.querySelector('input,textarea');const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
  const snapshot=async(name,width=1440)=>{
    await call('Emulation.setDeviceMetricsOverride',{width,height:1050,deviceScaleFactor:1,mobile:width===390})
    assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth'),false,`${name} overflows`)
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})
    writeFileSync(join(evidence,`${name}.png`),Buffer.from(shot.data,'base64'))
  }
  await call('Runtime.enable');await call('Page.enable')
  await call('Page.navigate',{url:'http://127.0.0.1:5174/scripts/ui-review.html?user=alex&theme=light#/new-proposal'})
  await waitFor(`document.querySelector('form.card input')`)
  const motivation=Array(151).fill('reason').join(' ')
  await fill('Working title','Browser perception idea')
  await fill('Abstract','A focused student experiment on perception with a distinct abstract.')
  await fill('Execution plan','Recruit a team.\n\nPilot in week two, analyze in week three.')
  await fill('Motivation',motivation)
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Submit a project idea'&&!b.disabled)`)
  await snapshot('proposal-desktop')
  await snapshot('proposal-mobile',390)
  await evaluate(`document.querySelector('form.card input').focus()`)
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
  assert.equal(await evaluate('location.hash'),'#/new-proposal','Enter must not submit')
  await click('Submit a project idea')
  await waitFor(`document.querySelector('.dashboard-proposals')?.textContent.includes('Project idea')`)
  await switchUser('maya')
  await waitFor(`document.querySelector('.dashboard-proposal-queue')`)
  await click('Approve & publish idea')
  await waitFor(`!document.querySelector('.dashboard-proposal-queue')`)
  await navigate('catalog/project-ideas')
  await waitFor(`document.querySelector('.idea-catalog-card')`)
  const ideaHref=await evaluate(`document.querySelector('.idea-catalog-card').getAttribute('href')`)
  await snapshot('ideas-mobile',390)
  await switchUser('')
  await navigate(ideaHref.slice(2))
  await waitFor(`document.querySelector('.project-idea-content')`)
  assert.equal(await evaluate(`document.querySelector('.project-idea-content').textContent.includes('Alex Rivera')`),true)
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Request to lead'))`),false)
  await switchUser('sam')
  await navigate(ideaHref.slice(2))
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Request to lead')`)
  await click('Request to lead')
  await fill('Your interest and availability','I can work weekends and recruit a small team.')
  await click('Send request to Research')
  await waitFor(`document.body.textContent.includes('Lead request pending Research review')`)
  await navigate('')
  await waitFor(`document.querySelector('.dashboard-lead-requests')?.textContent.includes('Pending')`)
  await switchUser('alex')
  await navigate(ideaHref.slice(2))
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Request to lead')`)
  await click('Request to lead')
  await fill('Your interest and availability','As the proposer, I could also lead on Mondays.')
  await click('Send request to Research')
  await waitFor(`document.body.textContent.includes('Lead request pending Research review')`)
  await switchUser('maya')
  await waitFor(`document.querySelectorAll('.dashboard-lead-queue > .dashboard-list > .card').length===2`)
  await snapshot('lead-queue-desktop')
  await evaluate(`(()=>{const card=[...document.querySelectorAll('.dashboard-lead-queue .card')].find(c=>c.textContent.includes('Sam Patel'));[...card.querySelectorAll('button')].find(b=>b.textContent.includes('Approve lead & start initiative')).click()})()`)
  await waitFor(`!document.querySelector('.dashboard-lead-queue')`)
  await switchUser('alex')
  await waitFor(`document.querySelector('.dashboard-lead-requests')?.textContent.includes('Taken up by another member')`)
  await navigate('catalog/project-ideas')
  await waitFor(`document.querySelector('.catalog-page')`)
  assert.equal(await evaluate('document.querySelectorAll(".idea-catalog-card").length'),0)
  await navigate(ideaHref.slice(2))
  await waitFor(`[...document.querySelectorAll('a')].some(a=>a.textContent==='Open resulting initiative')`)
  const resulting=await evaluate(`[...document.querySelectorAll('a')].find(a=>a.textContent==='Open resulting initiative').getAttribute('href')`)
  await navigate(resulting.slice(2))
  await waitFor(`document.body.textContent.includes('Idea proposed by Alex Rivera')`)
  assert.equal(await evaluate(`document.body.textContent.includes('Lead: Sam Patel')`),true)
  assert.equal(await evaluate(`document.querySelector('section[aria-label="Execution plan"]').textContent.includes('Pilot in week two')`),true)
  await snapshot('resulting-initiative-mobile',390)

  // Existing own-initiative flow with the explicit leadership action.
  await navigate('new-proposal')
  await waitFor(`document.querySelector('form.card input')`)
  await fill('Working title','Browser own initiative')
  await fill('Abstract','Another focused student experiment on perception.')
  await fill('Execution plan','Recruit a team and pilot the experiment next week.')
  await fill('Motivation',motivation)
  await click('Submit to lead this project')
  await waitFor(`document.querySelector('.dashboard-proposals')?.textContent.includes('Proposed initiative')`)
  await switchUser('maya')
  await waitFor(`document.querySelector('.dashboard-proposal-queue')`)
  await click('Approve & create initiative')
  await waitFor(`!document.querySelector('.dashboard-proposal-queue')`)
  await switchUser('alex')
  await waitFor(`document.querySelector('.dashboard-proposals')?.textContent.includes('Browser own initiative')`)
  const ownHref=await evaluate(`(()=>{const c=[...document.querySelectorAll('.dashboard-proposals .card')].find(c=>c.textContent.includes('Browser own initiative'));return [...c.querySelectorAll('a')].find(a=>a.textContent==='Open project').getAttribute('href')})()`)
  await navigate(ownHref.slice(2))
  await waitFor(`document.body.textContent.includes('Lead: Alex Rivera')`)
  assert.deepEqual(errors,[])
  console.log(`PASS (headless Chrome): explicit actions and Enter, public mobile catalog/detail, lead note and Research queue, competing applicants, retained links/content/credit, own-initiative approval. Screenshots: ${evidence}`)
} finally {
  socket?.close();chrome.kill()
}
