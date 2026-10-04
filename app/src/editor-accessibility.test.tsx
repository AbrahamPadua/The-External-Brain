// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it } from 'vitest'
import { Editor } from './Editor'
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true})
it('names actual editing surfaces and exposes the source as reading content',async()=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
  await act(async()=>root.render(<><Editor accessibleName="Peer review body" body="<p>Draft</p>"/>
    <Editor accessibleName="Source weekly update, version 1" body="<p>Source</p>" readOnly/></>))
  const writable=host.querySelector('[contenteditable="true"]')!
  expect(writable.getAttribute('role')).toBe('textbox')
  expect(writable.getAttribute('aria-label')).toBe('Peer review body')
  expect(writable.getAttribute('aria-multiline')).toBe('true')
  const source=host.querySelector('[contenteditable="false"]')!
  expect(source.getAttribute('role')).toBe('document')
  expect(source.getAttribute('aria-label')).toBe('Source weekly update, version 1')
  expect(host.querySelectorAll('[role="textbox"]')).toHaveLength(1)
  await act(async()=>root.unmount());host.remove()
})
