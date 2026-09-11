// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './App'

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
let host:HTMLDivElement|null=null
afterEach(()=>{host?.remove();host=null})

describe('accessible modal shell',()=>{
  it('focuses the intended field, traps Tab, and closes from Escape or backdrop',async()=>{
    const close=vi.fn()
    host=document.createElement('div');document.body.append(host)
    const root=createRoot(host)
    await act(async()=>root.render(<Modal titleId="heading" onRequestClose={close}>
      <h2 id="heading">Edit</h2><input aria-label="Title" autoFocus/><button>Last</button>
    </Modal>))
    const input=host.querySelector('input')!,last=host.querySelector('button')!
    expect(document.activeElement).toBe(input)
    last.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}))
    expect(document.activeElement).toBe(input)
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))
    expect(close).toHaveBeenCalledTimes(1)
    host.querySelector<HTMLElement>('.modal-overlay')!.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))
    expect(close).toHaveBeenCalledTimes(2)
    await act(async()=>root.unmount())
  })
})
