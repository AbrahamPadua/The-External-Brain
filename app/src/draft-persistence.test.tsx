// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useDraftPersistence } from './useDraftPersistence'

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
it.each(['weekly','review'])('%s save feedback follows its persisted snapshot and retains failed edits',async id=>{
  const host=document.createElement('div'); document.body.append(host); const root=createRoot(host)
  let resolve:(ok:boolean)=>void=()=>{}
  const persist=vi.fn((_snapshot:{documentId:string;title:string;body:string})=>new Promise<boolean>(r=>{resolve=r}))
  let draft:ReturnType<typeof useDraftPersistence>
  function Harness({docId}:{docId:string}) {
    draft=useDraftPersistence({documentId:docId,title:'Title',body:'Loaded'},persist)
    return <div>{draft.saveState}<span>{draft.body}</span></div>
  }
  await act(async()=>root.render(<Harness key={id} docId={id}/>))
  expect(host.textContent).toContain('Saved draft')
  expect(draft!.savedAt).toBeNull()
  await act(async()=>draft!.change({body:'First edit'}))
  expect(host.textContent).toContain('Unsaved changes')
  let pending:Promise<boolean>
  await act(async()=>{pending=draft!.save()})
  expect(host.textContent).toContain('Saving…')
  await act(async()=>draft!.change({body:'Newer edit'}))
  await act(async()=>{resolve(true);await pending})
  expect(host.textContent).toContain('Unsaved changes')
  expect(persist.mock.calls[0][0]).toMatchObject({documentId:id,body:'First edit'})
  await act(async()=>{pending=draft!.save()})
  await act(async()=>{resolve(false);await pending})
  expect(host.textContent).toContain('Save failed—retry')
  expect(draft!.body).toBe('Newer edit')
  await act(async()=>{pending=draft!.save()})
  await act(async()=>{resolve(true);await pending})
  expect(draft!.saveState).toBe('Saved')
  expect(draft!.unsaved).toBe(false)
  await act(async()=>{draft!.change({body:'Late'});pending=draft!.save()})
  await act(async()=>root.render(<Harness key="other" docId="other"/>))
  await act(async()=>{resolve(false);await pending})
  expect(draft!.saveState).toBe('Saved draft')
  expect(draft!.body).toBe('Loaded')
  await act(async()=>root.unmount());host.remove()
})
