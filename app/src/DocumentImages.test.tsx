// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DocumentImages } from './DocumentImages'
import { retryDocumentImage } from './live'
vi.mock('./live', () => ({ retryDocumentImage: vi.fn() }))
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.mocked(retryDocumentImage).mockReset()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
it('shows a retry without replacing a missing image or its durable path', async () => {
  await act(async () => root.render(<DocumentImages><img data-object-path="initiative/source.png" alt="Source diagram" /></DocumentImages>))
  expect(host.textContent).toContain('Image unavailable: Source diagram')
  expect(host.querySelector('img')?.getAttribute('data-object-path')).toBe('initiative/source.png')
  vi.mocked(retryDocumentImage).mockRejectedValue(new Error('not authorized'))
  await act(async () => host.querySelector('button')!.click())
  expect(host.textContent).toContain('Retry image')
  expect(host.textContent).not.toContain('not authorized')
})
it('refreshes the URL, checks decoding, and removes the warning', async () => {
  vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue(undefined)
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100)
  vi.mocked(retryDocumentImage).mockResolvedValue('https://images.example/refreshed.png')
  await act(async () => root.render(<DocumentImages><img data-object-path="initiative/source.png" alt="Source diagram" /></DocumentImages>))
  await act(async () => host.querySelector('button')!.click())
  expect(retryDocumentImage).toHaveBeenCalledWith('initiative/source.png')
  expect(host.querySelector('img')?.src).toBe('https://images.example/refreshed.png')
  expect(host.querySelector('button')).toBeNull()
  expect(host.querySelector('img')?.getAttribute('data-object-path')).toBe('initiative/source.png')
})
