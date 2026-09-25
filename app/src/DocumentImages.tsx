import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { retryDocumentImage } from './live'

/** Viewer-only recovery. It never writes placeholder text into document content. */
export function DocumentImages({ children, bucket = 'initiative-images' }: { children: ReactNode; bucket?: 'initiative-images' | 'initiative-content-images' }) {
  const root = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string[]>([])
  const generation = useRef(0)
  const missing = (img: HTMLImageElement) => {
    const path = img.getAttribute('data-object-path')
    if (path) setFailed(old => old[path] ? old : { ...old, [path]: img.alt || 'Document picture' })
  }
  useEffect(() => {
    const host = root.current
    if (!host) return
    const scan = () => host.querySelectorAll<HTMLImageElement>('img[data-object-path]').forEach(img => {
      if (!img.getAttribute('src') || (img.complete && img.naturalWidth === 0)) missing(img)
    })
    scan()
    const observer = new MutationObserver(scan)
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    return () => { generation.current++; observer.disconnect() }
  }, [])
  const retry = async (path: string) => {
    const requestGeneration = generation.current
    setBusy(old => [...old, path])
    try {
      const url = await retryDocumentImage(path, bucket)
      if (generation.current !== requestGeneration) return
      const probe = new Image()
      probe.src = url
      await probe.decode()
      if (generation.current !== requestGeneration) return
      root.current?.querySelectorAll<HTMLImageElement>('img[data-object-path]').forEach(img => {
        if (img.getAttribute('data-object-path') === path) img.src = url
      })
      setFailed(old => { const next = { ...old }; delete next[path]; return next })
    } catch { /* Keep the message and original durable path available for another retry. */ }
    finally { if (generation.current === requestGeneration) setBusy(old => old.filter(p => p !== path)) }
  }
  return <div ref={root} onErrorCapture={event => {
    if (event.target instanceof HTMLImageElement) missing(event.target)
  }}>
    {children}
    {Object.entries(failed).map(([path, label]) => <p key={path} role="status" className="muted">
      Image unavailable: {label}.{' '}
      <button type="button" className="btn ghost sm" disabled={busy.includes(path)}
        onClick={() => void retry(path)}>{busy.includes(path) ? 'Retrying…' : 'Retry image'}</button>
    </p>)}
  </div>
}
