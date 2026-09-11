/**
 * Inline image reference integrity across save and reload.
 *
 * The invariant: an uploaded image is identified for ever by its storage object
 * path in `data-object-path`. The `src` is a signed URL minted for one render
 * and expires, so it must be stripped on the way into the database and derived
 * again on the way out. If the path is ever lost - dropped by the Tiptap schema,
 * or overwritten by a stale signed URL - the image is gone from every stored
 * version and cannot be recovered.
 *
 * This exercises the REAL implementations: CustomImage from src/Editor.tsx and
 * stripSignedUrls / applyImageUrls / objectPathsIn from src/live.ts. Nothing is
 * re-implemented here, so the test fails if production drifts.
 *
 * Those functions need a DOM (DOMParser and, for Tiptap, window/document), which
 * this repo does not ship a test implementation of. The suite therefore adopts
 * happy-dom or jsdom if either is installed and SKIPS otherwise, so a plain
 * `npx vitest run` stays green. To turn it on:  npm i -D happy-dom
 */
import { beforeAll, describe, expect, it } from 'vitest'

type DomWindow = Record<string, unknown>

/** Adopt an installed DOM, if there is one. Returns false when there is not. */
async function adoptDom(): Promise<boolean> {
  if (typeof (globalThis as { DOMParser?: unknown }).DOMParser !== 'undefined') return true
  for (const name of ['happy-dom', 'jsdom']) {
    try {
      const lib = await import(/* @vite-ignore */ name)
      const win: DomWindow = name === 'happy-dom'
        ? new (lib as { Window: new () => DomWindow }).Window()
        : new (lib as { JSDOM: new (html: string) => { window: DomWindow } }).JSDOM('').window
      // generateJSON reads window.DOMParser, getHTMLFromFragment reads the bare
      // `document`, and live.ts reads the bare `DOMParser`, so all three are set.
      Object.assign(globalThis, {
        window: win, document: win.document, DOMParser: win.DOMParser, Node: win.Node,
      })
      return true
    } catch {
      // Not installed - try the next one.
    }
  }
  return false
}

const hasDom = await adoptDom()
if (!hasDom) {
  console.warn('[image-refs] skipped: no DOM available. Run `npm i -D happy-dom` to enable.')
}

// Loaded after the DOM exists, because Tiptap reads the global window on import.
let strip: (html: string) => string
let apply: (html: string, urls: Map<string, string>) => string
let pathsIn: (html: string) => string[]
let toJSON: (html: string) => unknown
let toHTML: (json: unknown) => string

const PATH_A = '2f1c8a4e-0000-4000-8000-000000000001/9b1d.png'
const PATH_B = '2f1c8a4e-0000-4000-8000-000000000001/7c2e.webp'
const SIGNED = 'https://project.supabase.co/storage/v1/object/sign/initiative-images/'
  + PATH_A + '?token=eyJhbGciOi.expired'

describe.skipIf(!hasDom)('inline image references survive save and reload', () => {
  beforeAll(async () => {
    const [live, editor, core, kit] = await Promise.all([
      import('./live'), import('./Editor'), import('@tiptap/core'), import('@tiptap/starter-kit'),
    ])
    strip = live.stripSignedUrls
    apply = live.applyImageUrls
    pathsIn = live.objectPathsIn
    // The real editor schema: StarterKit plus the production CustomImage.
    const extensions = [kit.default, editor.CustomImage] as Parameters<typeof core.generateJSON>[1]
    toJSON = (html) => core.generateJSON(html, extensions)
    toHTML = (json) => core.generateHTML(json as never, extensions)
  })

  it('keeps data-object-path through a Tiptap parse and serialise', () => {
    const out = toHTML(toJSON(`<img src="${SIGNED}" data-object-path="${PATH_A}">`))
    expect(pathsIn(out)).toEqual([PATH_A])
  })

  it('keeps the display src in the editor so an uploaded image is visible', () => {
    // The earlier defect blanked src inside renderHTML, which persisted the path
    // correctly but rendered every managed image as an empty box while editing.
    const out = toHTML(toJSON(`<img src="${SIGNED}" data-object-path="${PATH_A}">`))
    expect(out).toContain('token=eyJhbGciOi.expired')
  })

  it('strips the signed URL but never the path', () => {
    const stored = strip(toHTML(toJSON(`<img src="${SIGNED}" data-object-path="${PATH_A}">`)))
    expect(pathsIn(stored)).toEqual([PATH_A])
    expect(stored).not.toContain('token=')
    expect(stored).not.toContain('supabase.co')
    expect(stored).not.toMatch(/src="[^"]+"/)
  })

  it('resolves a stored path back to a fresh URL', () => {
    const stored = strip(`<img src="${SIGNED}" data-object-path="${PATH_A}">`)
    const fresh = apply(stored, new Map([[PATH_A, 'https://fresh.example/signed?token=new']]))
    expect(fresh).toContain('https://fresh.example/signed?token=new')
    expect(pathsIn(fresh)).toEqual([PATH_A])
  })

  it('leaves an unresolvable image blank but keeps its path recoverable', () => {
    // A viewer who may not read the object gets no URL. The reference has to
    // survive anyway, or the next save would drop the image permanently.
    const stored = strip(`<img src="${SIGNED}" data-object-path="${PATH_A}">`)
    const unresolved = apply(stored, new Map())
    expect(pathsIn(unresolved)).toEqual([PATH_A])
    expect(unresolved).not.toMatch(/src="[^"]+"/)
    expect(strip(unresolved)).toBe(stored)
  })

  it('does not touch an externally linked image', () => {
    const mixed = `<img src="https://cdn.example/logo.png">`
      + `<img src="${SIGNED}" data-object-path="${PATH_A}">`
    const stored = strip(mixed)
    expect(stored).toContain('https://cdn.example/logo.png')
    expect(stored).not.toContain('token=')
  })

  it('loses nothing over save, reload, edit and save again', () => {
    const typed = `<img src="blob:local-preview-1" data-object-path="${PATH_A}">`
      + `<img src="blob:local-preview-2" data-object-path="${PATH_B}">`
    // 1. the editor serialises what the author sees
    const edited = toHTML(toJSON(typed))
    // 2. saved: canonical content, no URLs
    const saved = strip(edited)
    expect(pathsIn(saved)).toEqual([PATH_A, PATH_B])
    expect(saved).not.toMatch(/src="[^"]+"/)
    // 3. reloaded for someone allowed to read both
    const reloaded = apply(saved, new Map([[PATH_A, 'https://x/1'], [PATH_B, 'https://x/2']]))
    expect(reloaded).toContain('https://x/1')
    expect(reloaded).toContain('https://x/2')
    // 4. reopened in the editor and saved again: identical canonical content
    const resaved = strip(toHTML(toJSON(reloaded)))
    expect(pathsIn(resaved)).toEqual([PATH_A, PATH_B])
    expect(resaved).toBe(saved)
  })

  it('survives a reload where only some images can be signed', () => {
    const saved = strip(`<img src="a" data-object-path="${PATH_A}">`
      + `<img src="b" data-object-path="${PATH_B}">`)
    const partial = apply(saved, new Map([[PATH_A, 'https://x/1']]))
    expect(partial).toContain('https://x/1')
    // The unsigned one is blank, not dropped, and re-saving restores the canon.
    expect(pathsIn(partial)).toEqual([PATH_A, PATH_B])
    expect(strip(partial)).toBe(saved)
  })
})
