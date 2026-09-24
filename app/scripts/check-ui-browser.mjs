// Local fictional-data review using the installed Chrome; no browser dependency.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const output = join(tmpdir(), 'openlabs-ui-evidence')
mkdirSync(output, { recursive: true })
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'openlabs-browser-'))}`,
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
const browserUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000)
  chrome.on('error', reject)
  chrome.stderr.on('data', chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]) } })
})
let socket
try {
  const origin = new URL(browserUrl).origin.replace('ws:', 'http:')
  const target = await (await fetch(`${origin}/json/new?about:blank`, { method: 'PUT' })).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let id = 0
  let onPageLoaded
  const waiting = new Map()
  const errors = []
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.method === 'Page.loadEventFired') onPageLoaded?.()
    if (message.id) { const pending = waiting.get(message.id); waiting.delete(message.id); if (message.error) pending?.reject(new Error(JSON.stringify(message.error))); else pending?.resolve(message.result) }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
  })
  const call = (method, params = {}) => new Promise((resolve, reject) => { waiting.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value }
  await call('Runtime.enable')
  await call('Page.enable')
  const results = []
  for (const [name, width, theme, user, route] of [
    ['dashboard-dark',1440,'dark','maya',''], ['dashboard-reference',1600,'dark','maya',''], ['dashboard-mobile',390,'dark','maya',''],
    ['dashboard-tablet',768,'dark','alex',''], ['dashboard-light',1440,'light','sam',''],
    ['catalog-desktop',1440,'dark','maya','catalog'], ['catalog-light',1440,'light','maya','catalog'], ['catalog-visitor',1440,'light','','catalog'], ['catalog-mobile',390,'dark','alex','catalog'], ['settings-mobile',390,'dark','maya','settings'],
    ['expired-link',390,'dark','','error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'],
    ['signin-code',390,'dark','','signin'],
    ['signin-confirm',390,'dark','','confirm-email/' + 'a'.repeat(56)],
    ['initiative-dark',1440,'dark','maya','initiative/sound/overview'],
    ['visitor-mobile',390,'dark','',''], ['accounts-dark',1440,'dark','sam','accounts'],
    ['document-mobile',390,'dark','maya','document/rm-sound'],
    ['accounts-mobile',390,'dark','sam','accounts'],
    ['loader-light',1440,'light','',''], ['loader-mobile',390,'dark','',''], ['loader-reduced',1440,'dark','',''],
  ]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 390 })
    await call('Emulation.setTouchEmulationEnabled', { enabled: width === 390 })
    const loader = name.startsWith('loader')
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: name === 'loader-reduced' ? 'reduce' : 'no-preference' }] })
    const pageLoaded = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Page load timed out')), 15000)
      onPageLoaded = () => { clearTimeout(timeout); resolve() }
    })
    const navigation = await call('Page.navigate', { url: `http://127.0.0.1:5174/scripts/ui-review.html?theme=${theme}&user=${user}${loader ? '&loader=1' : ''}${route === 'catalog' ? '&catalogEdge=1' : ''}${name === 'signin-code' ? '&live=1' : ''}#/${route}` })
    if (!navigation.loaderId) onPageLoaded()
    await pageLoaded
    await evaluate(`new Promise((resolve,reject)=>{let tries=0;const check=()=>{if(document.querySelector('${loader ? '.workspace-loader' : '.ol-page'}'))resolve(true);else if(++tries>100)reject('App not ready');else setTimeout(check,100)};check()})`)
    const state = await evaluate(`({ title: document.querySelector('h1')?.textContent, overflow: document.documentElement.scrollWidth > innerWidth, navVisible: document.querySelector('#primary-navigation') ? getComputedStyle(document.querySelector('#primary-navigation')).display !== 'none' : null, theme: document.querySelector('.ol')?.className })`)
    if (loader) {
      state.imageLoaded = await evaluate(`new Promise(resolve=>{const img=document.querySelector('.workspace-loader img');if(img.complete)resolve(img.naturalWidth>0);else {img.onload=()=>resolve(true);img.onerror=()=>resolve(false)}})`)
      state.canvasChanges = await evaluate(`new Promise(resolve=>{const c=document.querySelector('canvas');const before=c.toDataURL();setTimeout(()=>resolve(before!==c.toDataURL()),180)})`)
      state.canvasSized = await evaluate(`document.querySelector('canvas').width >= innerWidth`)
      state.reducedMotion = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)
    }
    if (name === 'expired-link') state.authRecovery = await evaluate(`document.querySelector('h1')?.textContent.includes('sign-in link') && !!document.querySelector('a[href="#/signin"]') && !document.body.textContent.includes('Nothing here')`)
    if (name === 'signin-confirm') {
      state.confirmWaitsForClick = await evaluate(`document.querySelector('h1')?.textContent === 'Finish signing in' && !window.__verifyLinkCalls`)
      await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Sign in to The External Brain')).click()`)
      state.confirmSignsIn = await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(window.__verifyLinkCalls === 1 && location.hash === '#/'),100))`)
    }
    if (name === 'signin-code') {
      state.codeInput = await evaluate(`!!document.querySelector('input[autocomplete="one-time-code"]') && !!Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Sign in with code'))`)
      await evaluate(`var email=document.querySelector('input[type=email]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(email,'member@example.test');email.dispatchEvent(new Event('input',{bubbles:true}))`)
      await evaluate(`new Promise(resolve=>setTimeout(resolve,70))`)
      await evaluate(`Array.from(document.querySelectorAll('button')).find(button=>button.textContent.includes('Send sign-in email')).click()`)
      state.codeAfterSend = await evaluate(`new Promise(resolve=>setTimeout(()=>resolve(document.activeElement === document.querySelector('input[autocomplete="one-time-code"]') && document.body.textContent.includes('Email sent — enter your code here')),150))`)
    }
    if (route === 'catalog') {
      state.cardCount = await evaluate(`document.querySelectorAll('.catalog-card').length`)
      await evaluate(`document.querySelector('.catalog-card')?.focus()` )
      await evaluate(`new Promise(resolve=>setTimeout(resolve,250))`)
      state.detailsAccessible = await evaluate(`getComputedStyle(document.querySelector('.catalog-overlay')).opacity === '1'`)
    }
    if (width === 390 && !loader) {
      await evaluate(`document.querySelector('.ol-nav-toggle').click()`)
      state.menuOpens = await evaluate(`getComputedStyle(document.querySelector('#primary-navigation')).display !== 'none'`)
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
      await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })
      state.menuCloses = await evaluate(`getComputedStyle(document.querySelector('#primary-navigation')).display === 'none'`)
    }
    if (route === 'catalog' && width === 390) {
      state.detailsFit = await evaluate(`Array.from(document.querySelectorAll('.catalog-card')).every(card=>card.querySelector('.catalog-overlay').getBoundingClientRect().bottom <= card.querySelector('.catalog-card-bottom').getBoundingClientRect().top + 1)`)
    }
    const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    writeFileSync(join(output, `${name}.png`), Buffer.from(screenshot.data, 'base64'))
    if (route === 'catalog') {
      state.activeDefault = state.cardCount === 2
      const settle = () => evaluate(`new Promise(resolve=>setTimeout(resolve,70))`)
      await evaluate(`document.querySelectorAll('.catalog-chip')[1].click()`)
      await settle()
      state.categoryFilters = await evaluate(`document.querySelectorAll('.catalog-card').length === 1`)
      await evaluate(`document.querySelector('.catalog-chip').click();var input=document.querySelector('.catalog-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Alex Rivera');input.dispatchEvent(new Event('input',{bubbles:true}))`)
      await settle()
      state.leadSearch = await evaluate(`document.querySelectorAll('.catalog-card').length === 1 && document.querySelector('.catalog-card-title').textContent === 'Memory in Motion'`)
      await evaluate(`var input=document.querySelector('.catalog-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-such-initiative');input.dispatchEvent(new Event('input',{bubbles:true}))`)
      await settle()
      state.emptySearch = await evaluate(`document.querySelectorAll('.catalog-card').length === 0`)
      await evaluate(`var input=document.querySelector('.catalog-search');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));var select=document.querySelector('.catalog-select');select.value='desc';select.dispatchEvent(new Event('change',{bubbles:true}))`)
      await settle()
      state.sortWorks = await evaluate(`document.querySelector('.catalog-card-title').textContent === 'Spatial Sound Lab'`)
      if (user) {
        await evaluate(`document.querySelector('.catalog-toolbar input[type=checkbox]').click()`)
        await settle()
        state.activeToggle = await evaluate(`document.querySelectorAll('.catalog-card').length === 3`)
      } else {
        state.inactiveHidden = await evaluate(`!document.querySelector('.catalog-page').textContent.includes('Withheld')`)
      }
      if (!user) state.visitorActiveOnly = await evaluate(`!document.querySelector('.catalog-toolbar input[type=checkbox]')`)
    }
    results.push({ name, width, ...state })
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify({ results, errors }, null, 2))
  console.log(JSON.stringify({ output, results, errors }, null, 2))
  if (errors.length || results.some(result => result.overflow || result.menuOpens === false || result.menuCloses === false || result.imageLoaded === false || result.authRecovery === false || result.confirmWaitsForClick === false || result.confirmSignsIn === false || result.codeInput === false || result.codeAfterSend === false || result.detailsAccessible === false || result.detailsFit === false || result.activeDefault === false || result.sortWorks === false || result.activeToggle === false || result.inactiveHidden === false || result.categoryFilters === false || result.leadSearch === false || result.emptySearch === false || result.visitorActiveOnly === false || result.canvasSized === false || (result.canvasChanges !== undefined && result.canvasChanges === result.reducedMotion))) process.exitCode = 1
} finally { socket?.close(); chrome.kill() }
