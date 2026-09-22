// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { startConnectingIdeas } from './connectingIdeas'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('caps rendering, pauses for visibility and reduced motion, and releases listeners', () => {
  const draw = vi.fn()
  const context = new Proxy({ drawImage: draw, createRadialGradient: () => ({ addColorStop() {} }) }, {
    get(target, key) { return Reflect.get(target, key) ?? (() => {}) },
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
  const media = Object.assign(new EventTarget(), { matches: false })
  vi.spyOn(window, 'matchMedia').mockReturnValue(media as MediaQueryList)
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const frames = new Map<number, FrameRequestCallback>()
  let serial = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++serial, callback); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const tick = (time: number) => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(time)) }
  const canvas = document.createElement('canvas')
  const cleanup = startConnectingIdeas(canvas, true)
  expect(draw).toHaveBeenCalledTimes(1)
  tick(16)
  expect(draw).toHaveBeenCalledTimes(1)
  tick(34)
  expect(draw).toHaveBeenCalledTimes(2)
  expect(frames.size).toBe(1)
  hidden = true
  document.dispatchEvent(new Event('visibilitychange'))
  expect(frames.size).toBe(0)
  hidden = false
  document.dispatchEvent(new Event('visibilitychange'))
  expect(frames.size).toBe(1)
  media.matches = true
  media.dispatchEvent(new Event('change'))
  expect(frames.size).toBe(0)
  const still = draw.mock.calls.length
  tick(100)
  expect(draw).toHaveBeenCalledTimes(still)
  media.matches = false
  media.dispatchEvent(new Event('change'))
  expect(frames.size).toBe(1)
  cleanup()
  expect(frames.size).toBe(0)
  const final = draw.mock.calls.length
  window.dispatchEvent(new Event('resize'))
  document.dispatchEvent(new Event('visibilitychange'))
  media.dispatchEvent(new Event('change'))
  expect(draw).toHaveBeenCalledTimes(final)
  expect(frames.size).toBe(0)
})

it('allows the text loader to remain usable without a canvas context', () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  expect(() => startConnectingIdeas(document.createElement('canvas'), false)()).not.toThrow()
})
