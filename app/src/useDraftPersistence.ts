import { useEffect, useRef, useState } from 'react'

type Snapshot = { documentId:string; title:string; body:string }
type SaveState = 'Saved draft' | 'Unsaved changes' | 'Saving…' | 'Saved' | 'Save failed—retry'
const same = (a:Snapshot,b:Snapshot) => a.documentId===b.documentId && a.title===b.title && a.body===b.body

/** Each editor is keyed by document id. Save responses acknowledge only their snapshot. */
export function useDraftPersistence(initial:Snapshot, persist:(snapshot:Snapshot)=>Promise<boolean>) {
  const [snapshot,setSnapshot] = useState(initial)
  const latest = useRef(initial), saved = useRef(initial), alive = useRef(true), sequence = useRef(0)
  const callback = useRef(persist); callback.current = persist
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [saveState,setSaveState] = useState<SaveState>('Saved draft')
  const [savedAt,setSavedAt] = useState<number|null>(null)
  const [unsaved,setUnsaved] = useState(false)
  const cancelAutosave = () => clearTimeout(timer.current)
  useEffect(()=>{alive.current=true; return ()=>{alive.current=false;cancelAutosave()}},[])
  const change = (patch:Partial<Pick<Snapshot,'title'|'body'>>) => {
    latest.current = {...latest.current,...patch}
    setSnapshot(latest.current)
    const dirty = !same(latest.current,saved.current)
    setUnsaved(dirty); setSaveState(dirty ? 'Unsaved changes' : 'Saved')
  }
  const save = async () => {
    cancelAutosave()
    const pending = {...latest.current}, request = ++sequence.current
    setSaveState('Saving…')
    let ok=false
    try { ok=await callback.current(pending) } catch { /* Keep the draft and offer retry. */ }
    if(!alive.current || request!==sequence.current) return ok
    if(ok) {
      saved.current=pending
      const dirty=!same(latest.current,pending)
      setUnsaved(dirty); setSaveState(dirty ? 'Unsaved changes' : 'Saved')
      if(!dirty)setSavedAt(Date.now())
    } else { setUnsaved(true);setSaveState('Save failed—retry') }
    return ok
  }
  useEffect(()=>{
    if(same(snapshot,saved.current))return
    timer.current=setTimeout(()=>void save(),900)
    return cancelAutosave
  },[snapshot])
  return {title:snapshot.title,body:snapshot.body,change,save,cancelAutosave,saveState,savedAt,unsaved}
}
