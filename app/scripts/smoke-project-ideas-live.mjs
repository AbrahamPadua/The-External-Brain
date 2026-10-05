// Authorized, isolated production smoke check. Uses only a generated private fixture.
// Setup and cleanup require SQL Editor access; no privileged key is used here.
// Usage: node scripts/smoke-project-ideas-live.mjs <private fixture.json> [--probe | --browser-probe | --resume | --verify-cleanup]
import { createClient } from '@supabase/supabase-js'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { readPublicConfig } from './prepare-project-ideas-live.mjs'

async function main() {
  assert.ok(process.argv[2], 'Supply the generated private fixture.json path')
  const path=resolve(process.argv[2]), f=JSON.parse(readFileSync(path,'utf8'))
  assert.equal(f.version,1,'Unsupported fixture version')
  assert.match(f.run,/^[a-f0-9]{16}$/,'Invalid fixture marker')
  assert.equal(f.titles.length,2,'Two exact test titles are required')
  assert.deepEqual(f.titles,[`Smoke ${f.run}: project idea`,`Smoke ${f.run}: own initiative`])
  for(const [role,a] of [['Research',f.research],['Applicant',f.applicant]]) {
    assert.equal(a.email,`openlabs-${role.toLowerCase()}-${f.run}@example.invalid`,'Use generated fixture accounts')
    assert.ok(a.password && a.id,'Fixture credentials are missing')
  }
  const config=readPublicConfig()
  assert.ok(f.base===config.base&&f.key===config.key,'Fixture must match this workspace\'s frontend project')
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})}}
  const anon=createClient(f.base,f.key,options), actors={}, authenticated=[]
  let chrome, socket
  const rows=async(actor,table,filters={},columns='*')=> {
    let q=(actor?.client??anon).from(table).select(columns)
    for(const [key,value] of Object.entries(filters))q=q.eq(key,value)
    const {data,error}=await q
    if(error)throw new Error(`Read of ${table} failed (${error.code})`)
    return data
  }
  const rpc=async(actor,name,args)=> {
    const {data,error}=await actor.client.rpc(name,args)
    if(error)throw new Error(`RPC ${name} failed (${error.code})`)
    return data
  }
  const denied=async(actor,name,args,pattern)=> {
    const {error}=await actor.client.rpc(name,args)
    assert.ok(error && pattern.test(error.message),`Expected permission or validation denial from ${name}`)
  }
  const deniedIdeas=async()=> {
    const {error,status}=await anon.from('project_idea_catalog').select('id,title,summary,execution_plan,motivation').limit(1)
    assert.ok([401,403].includes(status)&&error?.code==='42501','Project ideas must deny anonymous reads; apply migration 027')
  }
  if(process.argv.includes('--verify-cleanup')) {
    await deniedIdeas()
    for(const title of f.titles) {
      assert.equal((await rows(null,'initiative_catalog',{title},'id')).length,0,'Test initiative remains public')
    }
    for(const account of [f.research,f.applicant,...(f.temporaryPassword?[f.member]:[])]) {
      const client=createClient(f.base,f.key,options)
      const {error}=await client.auth.signInWithPassword({email:account.email,password:account.password})
      if(!error){await client.auth.signOut({scope:'local'});throw new Error('A disposable credential is still usable after cleanup')}
      assert.ok(['user_banned','invalid_credentials'].includes(error.code),'Cleanup authentication check could not be completed')
    }
    console.log('PASS (live cleanup): public test initiatives removed, ideas inaccessible anonymously, and temporary credentials disabled. Private proposal removal is enforced by cleanup.sql.')
    return
  }
  try {
    for(const [role,account] of Object.entries({member:f.member,research:f.research,applicant:f.applicant})) {
      const client=createClient(f.base,f.key,options)
      const {data,error}=await client.auth.signInWithPassword({email:account.email,password:account.password})
      if(error||!data.session)throw new Error(`Cannot authenticate disposable ${role}; check that setup.sql succeeded (${error?.code??'no session'})`)
      authenticated.push(client)
      if(account.id)assert.equal(data.user.id,account.id,'Authenticated user must match the fixture')
      const profile=(await rows({client},'profiles',{id:data.user.id},'id,display_name,account_status'))[0]
      assert.equal(profile?.account_status,'approved',`Disposable ${role} must be approved`)
      actors[role]={client,session:data.session,id:data.user.id,name:profile.display_name}
    }
    const {member,research,applicant}=actors
    const memberRoles=await rows(member,'role_grants',{user_id:member.id},'role,revoked_at')
    assert.ok(!memberRoles.some(r=>!r.revoked_at&&['research','admin'].includes(r.role)),'Use a member without Research privileges')
    assert.ok((await rows(research,'role_grants',{user_id:research.id},'role,revoked_at')).some(r=>r.role==='research'&&!r.revoked_at),'Reviewer requires Research access')
    console.log('PASS: designated member and disposable applicant/Research sessions authenticated.')
    if(process.argv.includes('--probe'))return
    const previous=await rows(research,'proposals',{author_id:member.id,title:f.titles[0]})
    if(!process.argv.includes('--browser-probe')) {
      assert.equal((await rows(research,'proposals',{author_id:member.id,title:f.titles[1]},'id')).length,0,'This run already has an own-initiative submission')
      if(process.argv.includes('--resume')) {
        assert.equal(previous.length,1,'Resume requires exactly one existing fixture proposal')
        assert.ok(['draft','submitted','changes_requested'].includes(previous[0].status),'Resume currently supports the pre-publication form stage')
        assert.equal((await rows(research,'initiatives',{proposal_id:previous[0].id},'id')).length,0,'Resumed proposal must not have an initiative')
      } else assert.equal(previous.length,0,'This run already has submissions; use --resume for a pre-publication form check')
    }

    const browserPath=process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe'
    chrome=spawn(browserPath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
      `--user-data-dir=${mkdtempSync(join(tmpdir(),'openlabs-ideas-live-browser-'))}`],{windowsHide:true,stdio:['ignore','ignore','pipe']})
    const browserUrl=await new Promise((resolve,reject)=> {
      const timer=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000)
      chrome.once('error',()=>{clearTimeout(timer);reject(new Error('Chrome could not start'))})
      chrome.stderr.on('data',chunk=>{const m=String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);if(m){clearTimeout(timer);resolve(m[1])}})
    })
    const target=await(await fetch(`${new URL(browserUrl).origin.replace('ws:','http:')}/json/new?about:blank`,{method:'PUT'})).json()
    socket=new WebSocket(target.webSocketDebuggerUrl)
    await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}))
    let seq=0, initScript=null, navigation=0
    const waiting=new Map(), errors=[], network=[]
    socket.addEventListener('message',event=> {
      const message=JSON.parse(event.data)
      if(message.id) {
        const p=waiting.get(message.id);waiting.delete(message.id);clearTimeout(p?.timer)
        if(message.error)p?.reject(new Error('Browser protocol request failed'));else p?.resolve(message.result)
      }
      if(message.method==='Runtime.exceptionThrown')errors.push('Browser runtime exception')
      if(message.method==='Network.loadingFailed')network.push({failure:message.params.errorText,type:message.params.type})
      if(message.method==='Network.responseReceived'&&message.params.response.status>=400) {
        const url=new URL(message.params.response.url)
        network.push({origin:url.origin,path:url.pathname,status:message.params.response.status})
      }
    })
    const call=(method,params={})=>new Promise((resolve,reject)=> {
      const id=++seq, timer=setTimeout(()=>{waiting.delete(id);reject(new Error(`Browser ${method} timed out`))},45000)
      waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
    })
    // Avoid including evaluated source in errors: session injection contains credentials.
    const evaluate=async expression=> {
      const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
      if(result.exceptionDetails)throw new Error('Browser evaluation failed')
      return result.result.value
    }
    const waitFor=async(condition,label)=> {
      try {await evaluate(`new Promise((resolve,reject)=>{let n=0;const check=()=>{if(${condition})resolve(true);else if(++n>350)reject(new Error('UI timeout'));else setTimeout(check,100)};check()})`)}
      catch {throw new Error(`Timed out waiting for ${label}`)}
    }
    const hasButton=label=>`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`
    const card=(selector,title,name=null)=>`[...document.querySelectorAll(${JSON.stringify(selector)})].find(c=>c.querySelector('h3')?.textContent.trim()===${JSON.stringify(title)}${name?`&&c.textContent.includes(${JSON.stringify(name)})`:''})`
    const click=async(label,root='document')=>evaluate(`(()=>{const b=[...(${root}).querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw new Error('Button unavailable');b.click()})()`)
    const setValue=async(element,value)=>evaluate(`(()=>{const e=${element};if(!e||e.disabled)throw new Error('Input unavailable');const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
    const field=label=>`[...document.querySelectorAll('label.field')].find(l=>l.querySelector('.field-label')?.textContent===${JSON.stringify(label)}).querySelector('input,textarea')`
    const liveUrl=process.env.OPENLABS_SMOKE_SITE_URL??'https://abrahampadua.github.io/The-External-Brain/'
    assert.equal(new URL(liveUrl).protocol,'https:','Use the hosted HTTPS application')
    const storageKey=`sb-${new URL(f.base).hostname.split('.')[0]}-auth-token`
    const visit=async(actor,route)=> {
      if(initScript)await call('Page.removeScriptToEvaluateOnNewDocument',{identifier:initScript})
      const id=++navigation
      const result=await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.removeItem(${JSON.stringify(storageKey)});${actor?`localStorage.setItem(${JSON.stringify(storageKey)},${JSON.stringify(JSON.stringify(actor.session))});`:''}window.__openlabsSmokeNavigation=${id};`})
      initScript=result.identifier
      // Hash changes alone keep the old document. A distinct query forces a fresh
      // document and applies the new actor's session before the app initializes.
      const url=new URL(liveUrl);url.searchParams.set('smoke_navigation',String(id));url.hash='/'+route
      const page=await call('Page.navigate',{url:url.href})
      if(page.errorText)throw new Error(`Hosted page navigation failed: ${page.errorText}`)
      try {
        await waitFor(`window.__openlabsSmokeNavigation===${id}&&document.querySelector('.ol-page')`,'authenticated application load')
      } catch(error) {
        const status=await evaluate(`({origin:location.origin,path:location.pathname,hash:location.hash,readyState:document.readyState,marker:window.__openlabsSmokeNavigation??null,workspaceVisible:!!document.querySelector('.ol-page'),loaderVisible:!!document.querySelector('.workspace-loader'),connectionError:document.querySelector('.connection-state [role="alert"]')?.textContent??null})`)
        console.error(JSON.stringify({browserLoad:status,networkFailures:network,runtimeExceptions:errors.length}))
        throw error
      }
    }
    const navigate=async route=>evaluate(`location.hash=${JSON.stringify('#/'+route)}`)
    const fillProposal=async title=> {
      await waitFor(`document.querySelector('form.card input')`,'proposal form')
      await setValue(field('Working title'),title)
      await setValue(field('Abstract'),abstract)
      await setValue(field('Execution plan'),plan)
      await setValue(field('Motivation'),'Too short')
      assert.equal(await evaluate(`${hasButton('Submit to Brainstorm Genesis')}||${hasButton('Submit to lead this project')}`),false,'Both actions must enforce motivation requirements')
      await setValue(field('Motivation'),motivation)
      await waitFor(hasButton('Submit to Brainstorm Genesis'),'both valid submission actions')
      assert.equal(await evaluate(hasButton('Submit to lead this project')),true)
    }
    const proposal=async title=> {
      const found=await rows(research,'proposals',{author_id:member.id,title})
      assert.equal(found.length,1,'Only one fixture proposal per title is allowed')
      return found[0]
    }
    const leadRequest=async(actor,status)=> {
      const found=await rows(actor,'idea_lead_requests',{proposal_id:ideaId,applicant_id:actor.id,status})
      assert.equal(found.length,1,'Expected one fixture lead request in this state')
      return found[0]
    }
    const abstract='Disposable automated test of project ideas and requests to lead. This entry will be removed after validation.'
    const plan='Use disposable accounts to validate the full workflow.\n\nVerify content, proposer credit and memberships, then remove the test entries.'
    const motivation=Array(151).fill('testing').join(' ')
    await call('Runtime.enable');await call('Page.enable');await call('Network.enable')
    await visit(member,process.argv.includes('--resume')?`new-proposal/${previous[0].id}`:'new-proposal')
    if(process.argv.includes('--browser-probe')){console.log('PASS: authenticated hosted browser reached the proposal form.');return}
    let ideaId
    if(process.argv.includes('--resume')) {
      ideaId=previous[0].id
      console.log(`Resuming the existing fixture proposal (${previous[0].status}).`)
      if(previous[0].status==='draft') {
        await fillProposal(f.titles[0]);await click('Submit to Brainstorm Genesis')
        await waitFor(`document.querySelector('.dashboard-proposals')`,'resumed draft submission')
      }
    } else {
      await fillProposal(f.titles[0])
      await evaluate(`${field('Working title')}.focus()`)
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
      assert.equal(await evaluate('location.hash'),'#/new-proposal','Enter must not commit leadership')
      await click('Save draft')
      await waitFor(`document.querySelector('.dashboard-proposals')?.textContent.includes(${JSON.stringify(f.titles[0])})`,'saved draft on Home')
      const draft=await proposal(f.titles[0]);ideaId=draft.id
      assert.equal(draft.status,'draft')
      assert.equal((await rows(applicant,'project_idea_catalog',{id:ideaId})).length,0,'Draft must stay private')
      assert.equal((await rows(applicant,'proposals',{id:ideaId})).length,0,'Other members must not read drafts')
      await navigate(`new-proposal/${ideaId}`)
      await waitFor(`document.querySelector('form.card input')`,'restored draft')
      assert.equal(await evaluate(`${field('Execution plan')}.value`),plan,'Draft content must survive')
      await click('Submit to Brainstorm Genesis')
      await waitFor(`document.querySelector('.dashboard-proposals')?.textContent.includes('Brainstorm Genesis')`,'submitted idea label')
    }
    const submitted=await proposal(f.titles[0])
    assert.equal(submitted.purpose,'project_idea')
    await denied(member,'decide_proposal',{p_proposal:ideaId,p_status:'approved'},/research required/)
    if(submitted.status!=='changes_requested')await rpc(research,'decide_proposal',{p_proposal:ideaId,p_status:'changes_requested',p_reason:'Disposable check: preserve the selected project-idea purpose.'})
    await visit(member,`new-proposal/${ideaId}`)
    await waitFor(`document.body.textContent.includes('Previously submitted as:')&&document.body.textContent.includes('preserve the selected')`,'resubmission purpose and feedback')
    await click('Save draft')
    await waitFor(`document.querySelector('.dashboard-proposals')`,'changes saved as a draft')
    const saved=await proposal(f.titles[0])
    assert.equal(saved.purpose,'project_idea');assert.ok(saved.decision_reason)
    await navigate(`new-proposal/${ideaId}`)
    await waitFor(hasButton('Submit to Brainstorm Genesis'),'resubmission action')
    await click('Submit to Brainstorm Genesis')
    await waitFor(`document.querySelector('.dashboard-proposals')`,'resubmitted idea')
    await visit(research,'')
    const ideaCard=card('.dashboard-proposal-queue .card',f.titles[0])
    await waitFor(`(${ideaCard})?.textContent.includes('Brainstorm Genesis')`,'Research idea queue')
    await click('Approve & publish idea',ideaCard)
    await waitFor(`!(${ideaCard})`,'published idea decision')
    assert.equal((await rows(research,'initiatives',{proposal_id:ideaId})).length,0,'Approving an idea must not create a team')
    assert.equal((await rows(applicant,'project_idea_catalog',{id:ideaId}))[0]?.initiative_id,null)
    console.log('PASS: live form requirements, Enter, private draft, changes/resubmission, idea approval without a team.')

    await deniedIdeas()
    await visit(null,'catalog')
    await waitFor(`document.querySelector('.catalog-page')`,'public initiative catalog')
    assert.equal(await evaluate(`!!document.querySelector('a[role="tab"][href="#/catalog/project-ideas"]')`),false,'Visitors must not see the ideas tab')
    for(const route of ['catalog/project-ideas',`project-idea/${ideaId}`]) {
      await navigate(route)
      await waitFor(`document.body.textContent.includes('An approved account is needed here')`,'member-only idea access')
      assert.equal(await evaluate(`!!document.querySelector('.project-idea-content,.idea-catalog-card')||document.body.textContent.includes(${JSON.stringify(f.titles[0])})`),false,'Direct links must not expose ideas')
    }
    await visit(member,'catalog/project-ideas')
    await waitFor(`document.querySelector('a.idea-catalog-card[href="#/project-idea/${ideaId}"]')`,'available idea in the member catalog')
    await setValue("document.querySelector('input.catalog-search')",f.run)
    assert.equal(await evaluate('document.querySelectorAll("a.idea-catalog-card").length'),1,'Live catalog search must find the fixture idea')
    await navigate(`project-idea/${ideaId}`)
    await waitFor(`document.querySelector('.project-idea-content')`,'member-visible approved idea')
    assert.equal(await evaluate(`document.querySelector('.project-idea-content').textContent.includes(${JSON.stringify(member.name)})`),true,'Members must see proposer credit')
    const publicNotes=await anon.from('idea_lead_requests').select('id,message').eq('proposal_id',ideaId)
    assert.ok(publicNotes.error,'Applicant notes must be denied to anonymous users')
    await visit(applicant,`project-idea/${ideaId}`)
    await waitFor(hasButton('Request to lead'),'approved member lead action')
    await click('Request to lead')
    await setValue(field('Your interest and availability'),`Disposable applicant ${f.run}: available for a short validation session.`)
    await click('Send request to Research')
    await waitFor(`document.body.textContent.includes('Lead request pending Research review')`,'pending application')
    await navigate('')
    await waitFor(`document.querySelector('.dashboard-lead-requests')?.textContent.includes('Pending')`,'pending request on Home')
    const firstRequest=await leadRequest(applicant,'pending')
    await denied(research,'decide_idea_lead',{p_request:firstRequest.id,p_approve:false,p_reason:''},/decision feedback required/)
    await denied(member,'decide_idea_lead',{p_request:firstRequest.id,p_approve:true},/research required/)
    await visit(research,'')
    const applicantCard=card('.dashboard-lead-queue .card',f.titles[0],applicant.name)
    await waitFor(`(${applicantCard})`,'Research lead-request queue')
    await click('Decline',applicantCard)
    await setValue(`(${applicantCard}).querySelector('textarea')`,'Disposable validation decline: please reapply for the acceptance check.')
    await click('Decline',applicantCard)
    await waitFor(`!(${applicantCard})`,'decline with feedback')
    await visit(applicant,'')
    await waitFor(`document.querySelector('.dashboard-lead-requests')?.textContent.includes('Disposable validation decline')`,'decided request and feedback on Home')
    await navigate(`project-idea/${ideaId}`)
    await waitFor(hasButton('Request to lead'),'reapplication after decline')
    await click('Request to lead')
    await setValue(field('Your interest and availability'),`Disposable winner ${f.run}: available to lead this test.`)
    await click('Send request to Research')
    await waitFor(`document.body.textContent.includes('Lead request pending Research review')`,'new pending request')
    const winner=await leadRequest(applicant,'pending')
    assert.equal(await rpc(applicant,'request_idea_lead',{p_proposal:ideaId,p_message:'Retry must return the same pending application.'}),winner.id)
    await visit(member,`project-idea/${ideaId}`)
    await waitFor(hasButton('Request to lead'),'proposer may also apply')
    await click('Request to lead')
    await setValue(field('Your interest and availability'),`Disposable proposer ${f.run}: competing request to verify the taken status.`)
    await click('Send request to Research')
    await waitFor(`document.body.textContent.includes('Lead request pending Research review')`,'competing request')
    const competing=await leadRequest(member,'pending')
    assert.equal((await rows(member,'idea_lead_requests',{id:winner.id})).length,0,'Members may not read other applicants\' notes')
    await rpc(research,'decide_account',{p_user:applicant.id,p_status:'suspended',p_reason:`Disposable smoke ${f.run}`})
    try {
      assert.equal((await rows(applicant,'project_idea_catalog',{id:ideaId})).length,0,'Suspended accounts must not read ideas even with an existing session')
      await visit(applicant,`project-idea/${ideaId}`)
      await waitFor(`document.body.textContent.includes('Your account is suspended')`,'suspended idea access guard')
      assert.equal(await evaluate(`!!document.querySelector('.project-idea-content')`),false)
      await denied(applicant,'request_idea_lead',{p_proposal:ideaId,p_message:'Suspended applicants cannot make a request.'},/approved account required/)
      await denied(research,'decide_idea_lead',{p_request:winner.id,p_approve:true},/applicant must be approved/)
      assert.equal((await rows(research,'initiatives',{proposal_id:ideaId})).length,0,'Suspended applicant must not start an initiative')
    } finally {
      await rpc(research,'decide_account',{p_user:applicant.id,p_status:'approved',p_reason:`Disposable smoke ${f.run}`})
    }
    await visit(research,'')
    await waitFor(`(${applicantCard})`,'competing Research queue')
    await click('Approve lead & start initiative',applicantCard)
    await waitFor(`!(${applicantCard})`,'accepted lead decision')
    const initiativeRows=await rows(research,'initiatives',{proposal_id:ideaId})
    assert.equal(initiativeRows.length,1,'One idea must create exactly one initiative')
    const initiative=initiativeRows[0]
    assert.equal(initiative.lead_id,applicant.id)
    assert.equal(initiative.summary,abstract);assert.equal(initiative.content.execution_plan,plan)
    assert.equal(initiative.content.motivation,motivation);assert.equal(initiative.content.proposer_id,member.id)
    assert.equal((await rows(member,'idea_lead_requests',{id:competing.id}))[0].status,'taken')
    const notifications=await rows(applicant,'notifications',{'payload->>proposal_id':ideaId},'id')
    const proposerNotifications=await rows(member,'notifications',{'payload->>proposal_id':ideaId},'id')
    assert.equal(await rpc(research,'decide_idea_lead',{p_request:winner.id,p_approve:true}),initiative.id)
    assert.equal(await rpc(research,'decide_idea_lead',{p_request:competing.id,p_approve:true}),initiative.id)
    assert.equal((await rows(applicant,'notifications',{'payload->>proposal_id':ideaId},'id')).length,notifications.length,'Repeated decisions must not duplicate notifications')
    assert.equal((await rows(member,'notifications',{'payload->>proposal_id':ideaId},'id')).length,proposerNotifications.length,'Repeated decisions must not duplicate proposer notifications')
    const memberships=await rows(research,'initiative_memberships',{initiative_id:initiative.id},'user_id,role,left_at')
    assert.deepEqual(memberships,[{user_id:applicant.id,role:'lead',left_at:null}],'Only the accepted applicant joins')
    assert.equal((await rows(research,'obligations',{initiative_id:initiative.id},'id')).length,0)
    assert.equal((await rows(research,'hp_events',{initiative_id:initiative.id},'id')).length,0)
    assert.ok((await rows(member,'notifications',{'payload->>proposal_id':ideaId},'kind')).some(n=>n.kind==='project_idea_started'),'Notify the original proposer')
    await visit(member,'')
    await waitFor(`document.querySelector('.dashboard-lead-requests')?.textContent.includes('Taken up by another member')`,'taken request on Home')
    await visit(member,'catalog/project-ideas')
    await waitFor(`document.querySelector('.catalog-page')`,'member ideas list')
    assert.equal(await evaluate(`!!document.querySelector('a.idea-catalog-card[href="#/project-idea/${ideaId}"]')`),false,'Taken ideas leave the available list')
    await navigate(`project-idea/${ideaId}`)
    await waitFor(`document.querySelector('a[href="#/initiative/${initiative.id}/overview"]')`,'original detail links to the initiative')
    await navigate(`initiative/${initiative.id}/overview`)
    await waitFor(`document.body.textContent.includes(${JSON.stringify('Idea proposed by '+member.name)})`,'retained proposer credit on initiative')
    assert.equal(await evaluate(`document.body.textContent.includes(${JSON.stringify('Lead: '+applicant.name)})`),true)
    await visit(null,`initiative/${initiative.id}/overview`)
    await waitFor(`document.body.textContent.includes(${JSON.stringify('Idea proposed by '+member.name)})`,'public initiative retains credit')
    assert.equal(await evaluate(`!!document.querySelector('a[href="#/project-idea/${ideaId}"]')`),false,'Public initiatives must not link to member-only ideas')
    assert.equal((await rows(null,'initiative_catalog',{id:initiative.id}))[0].project_idea_id,null)
    console.log('PASS: member-only ideas, public initiative credit without private idea links, private notes, declines, suspension boundary, competition, one lead membership, retry safety, notifications, retained member idea links/content, no immediate obligations or HP.')

    await visit(member,'new-proposal')
    await fillProposal(f.titles[1])
    await click('Submit to lead this project')
    await waitFor(`document.querySelector('.dashboard-proposals')?.textContent.includes('Proposed initiative')`,'own-initiative submission')
    const ownProposal=await proposal(f.titles[1])
    assert.equal(ownProposal.purpose,'own_initiative')
    await visit(research,'')
    const ownCard=card('.dashboard-proposal-queue .card',f.titles[1])
    await waitFor(`(${ownCard})`,'Research own-initiative queue')
    await click('Approve & create initiative',ownCard)
    await waitFor(`!(${ownCard})`,'own-initiative approval')
    const ownInitiative=(await rows(research,'initiatives',{proposal_id:ownProposal.id}))[0]
    assert.equal(ownInitiative?.lead_id,member.id)
    assert.equal(ownInitiative.content.execution_plan,plan)
    assert.deepEqual(await rows(member,'initiative_memberships',{initiative_id:ownInitiative.id},'user_id,role,left_at'),[{user_id:member.id,role:'lead',left_at:null}])
    assert.equal((await rows(member,'project_idea_catalog',{id:ownProposal.id})).length,0,'Own proposals are not project ideas')
    await visit(member,`initiative/${ownInitiative.id}/overview`)
    await waitFor(`document.body.textContent.includes(${JSON.stringify('Lead: '+member.name)})`,'own initiative detail')
    assert.deepEqual(errors,[],'Live flows must not raise browser exceptions')
    const report={run:f.run,checkedAt:new Date().toISOString(),passed:true,proposalIds:[ideaId,ownProposal.id],initiativeIds:[initiative.id,ownInitiative.id]}
    writeFileSync(join(dirname(path),'result.json'),JSON.stringify(report,null,2),{mode:0o600})
    console.log(`PASS: existing own-initiative flow retains its lead and content. Both authenticated live flows passed. Run the private cleanup.sql next.`)
  } finally {
    socket?.close();chrome?.kill()
    // Revoke only sessions created by this check; preserve the member's other sessions.
    await Promise.allSettled(authenticated.map(client=>client.auth.signOut({scope:'local'})))
  }
}
main().catch(error=>{console.error(`FAIL: ${error.message}`);process.exitCode=1})
