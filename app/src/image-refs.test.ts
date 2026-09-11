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

/**
 * Pasting an image. `planPaste` is the decision the editor's handlePaste runs,
 * so this drives the real code path with a real clipboard payload rather than a
 * description of it. What must never happen is a persisted base64 blob or a
 * persisted signed URL: an image has to become an uploaded object path.
 */
describe.skipIf(!hasDom)('clipboard image paste', () => {
  let planPaste: (data: DataTransfer | null | undefined) => {
    kind: string; files?: File[]; html?: string; removed?: number
  }
  let clipboardImageFiles: (data: DataTransfer | null | undefined) => File[]
  let stripDataImages: (html: string) => { html: string; removed: number }

  beforeAll(async () => {
    // Re-bound here too so this suite stands on its own under a test filter.
    const [live, editor, core, kit] = await Promise.all([
      import('./live'), import('./Editor'), import('@tiptap/core'), import('@tiptap/starter-kit'),
    ])
    strip = live.stripSignedUrls
    pathsIn = live.objectPathsIn
    const extensions = [kit.default, editor.CustomImage] as Parameters<typeof core.generateJSON>[1]
    toJSON = (html) => core.generateJSON(html, extensions)
    toHTML = (json) => core.generateHTML(json as never, extensions)
    planPaste = editor.planPaste as typeof planPaste
    clipboardImageFiles = editor.clipboardImageFiles
    stripDataImages = editor.stripDataImages
  })

  const png = (name = 'pasted.png', type = 'image/png') =>
    new File([new Uint8Array(64)], name, { type })
  /** A clipboard shaped like the one a paste event carries. */
  const clipboard = (opts: { files?: File[]; html?: string; text?: string }) => ({
    files: opts.files ?? [],
    items: (opts.files ?? []).map((file) => ({ kind: 'file', getAsFile: () => file })),
    getData: (mime: string) => (mime === 'text/html' ? opts.html ?? '' : opts.text ?? ''),
  }) as unknown as DataTransfer

  it('routes a pasted image file to the upload flow', () => {
    const file = png()
    const plan = planPaste(clipboard({ files: [file] }))
    expect(plan.kind).toBe('upload')
    expect(plan.files).toHaveLength(1)
    expect(plan.files![0]).toBeInstanceOf(Blob)
    expect(plan.files![0].type).toBe('image/png')
  })

  it('prefers the file even when the clipboard also carries base64 markup', () => {
    // This is the usual shape of a screenshot paste: a real file plus an <img>
    // with a data: URL. Taking the file is what keeps base64 out of storage.
    const plan = planPaste(clipboard({
      files: [png()],
      html: '<img src="data:image/png;base64,AAAA">',
    }))
    expect(plan.kind).toBe('upload')
  })

  it('drops inline base64 rather than persisting it', () => {
    const plan = planPaste(clipboard({
      html: '<p>before</p><img src="data:image/png;base64,AAAA"><p>after</p>',
    }))
    expect(plan.kind).toBe('insert-html')
    expect(plan.removed).toBe(1)
    expect(plan.html).not.toContain('data:')
    expect(plan.html).toContain('before')
    expect(plan.html).toContain('after')
  })

  it('leaves ordinary text and linked images to the editor', () => {
    expect(planPaste(clipboard({ text: 'just words' })).kind).toBe('default')
    expect(planPaste(clipboard({ html: '<p><img src="https://cdn.example/a.png"></p>' })).kind)
      .toBe('default')
    expect(planPaste(null).kind).toBe('default')
  })

  it('ignores clipboard files outside the image allowlist', () => {
    expect(clipboardImageFiles(clipboard({ files: [png('x.svg', 'image/svg+xml')] }))).toHaveLength(0)
    expect(clipboardImageFiles(clipboard({ files: [png('x.pdf', 'application/pdf')] }))).toHaveLength(0)
    expect(clipboardImageFiles(clipboard({ files: [png()] }))).toHaveLength(1)
  })

  it('keeps managed and linked images while stripping only base64', () => {
    const mixed = `<img src="" data-object-path="${PATH_A}">`
      + '<img src="https://cdn.example/a.png">'
      + '<img src="data:image/gif;base64,BBBB">'
    const cleaned = stripDataImages(mixed)
    expect(cleaned.removed).toBe(1)
    expect(cleaned.html).toContain(PATH_A)
    expect(cleaned.html).toContain('cdn.example/a.png')
    expect(cleaned.html).not.toContain('data:')
  })

  it('ends up as a durable object-path reference, not a URL, once uploaded', async () => {
    // The upload result the adapter returns: an expiring URL for display and the
    // object path that is actually stored.
    const upload = async (file: File) => {
      expect(file).toBeInstanceOf(Blob)
      return { path: PATH_B, url: 'https://project.supabase.co/sign/x?token=short-lived' }
    }
    const plan = planPaste(clipboard({ files: [png('shot.png')] }))
    expect(plan.kind).toBe('upload')
    const res = await upload(plan.files![0])
    const inserted = toHTML(toJSON(`<img src="${res.url}" data-object-path="${res.path}">`))
    expect(pathsIn(inserted)).toEqual([PATH_B])
    const stored = strip(inserted)
    expect(pathsIn(stored)).toEqual([PATH_B])
    expect(stored).not.toContain('token=')
    expect(stored).not.toContain('data:')
  })
})
