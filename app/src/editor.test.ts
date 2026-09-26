/**
 * The rich-text editor's block commands and schema.
 *
 * - Slash menu filtering and the link / image URL rules are pure functions and
 *   are tested directly.
 * - The schema test round-trips a body carrying every block the editor can now
 *   produce (table, divider, checklist, quote, code block, uploaded image)
 *   through the REAL extensions from src/Editor.tsx, both directly and after the
 *   app's sanitize(), so a stored document can never lose one of those blocks
 *   on its way back into the editor or into a read-only view.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SLASH_COMMANDS, filterSlashCommands, normalizeImageUrl, normalizeLinkUrl,
} from './editor-commands'

const ids = (query: string) => filterSlashCommands(query).map((c) => c.id)

describe('slash command filtering', () => {
  it('offers every command, in order, before anything is typed', () => {
    expect(ids('')).toEqual(SLASH_COMMANDS.map((c) => c.id))
    expect(ids('   ')).toHaveLength(SLASH_COMMANDS.length)
    expect(ids('')).toEqual([
      'text', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'checklist',
      'quote', 'code', 'divider', 'table', 'image-upload', 'image-link',
    ])
  })

  it('ranks title prefixes first and keeps natural order on ties', () => {
    expect(ids('h').slice(0, 3)).toEqual(['h1', 'h2', 'h3'])
    expect(ids('Heading 2')[0]).toBe('h2')
    expect(ids('heading2')[0]).toBe('h2')
    expect(ids('H1 ')[0]).toBe('h1')
    expect(ids('tab')[0]).toBe('table')
    expect(ids('num')[0]).toBe('numbered')
    expect(ids('bul')[0]).toBe('bullet')
  })

  it('matches the words people actually type for a block', () => {
    expect(ids('todo')[0]).toBe('checklist')
    expect(ids('task')[0]).toBe('checklist')
    expect(ids('hr')[0]).toBe('divider')
    expect(ids('ul')[0]).toBe('bullet')
    expect(ids('ol')[0]).toBe('numbered')
    expect(ids('pre')[0]).toBe('code')
    expect(ids('blockquote')[0]).toBe('quote')
    expect(ids('gif')).toEqual(['image-link', 'image-upload'])   // title word beats keyword
    expect(ids('image')).toEqual(expect.arrayContaining(['image-upload', 'image-link']))
    expect(ids('link')).toContain('image-link')
  })

  it('offers nothing for a query that names no block', () => {
    expect(ids('zzzz')).toEqual([])
    expect(ids('qwerty')).toEqual([])
  })

  it('does not mutate the command list', () => {
    const before = SLASH_COMMANDS.map((c) => c.id)
    filterSlashCommands('li')
    expect(SLASH_COMMANDS.map((c) => c.id)).toEqual(before)
  })
})

describe('link and image URL rules', () => {
  it('accepts https and mailto links only', () => {
    expect(normalizeLinkUrl('https://example.org/a?b=c#d')).toBe('https://example.org/a?b=c#d')
    expect(normalizeLinkUrl('  mailto:team@example.org ')).toBe('mailto:team@example.org')
    expect(normalizeLinkUrl('http://example.org')).toBeNull()
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeLinkUrl('data:text/html,hi')).toBeNull()
    expect(normalizeLinkUrl('ftp://example.org')).toBeNull()
    expect(normalizeLinkUrl('')).toBeNull()
    expect(normalizeLinkUrl('not a url')).toBeNull()
  })

  it('reads a bare domain as https and a bare address as mailto', () => {
    expect(normalizeLinkUrl('example.org/page')).toBe('https://example.org/page')
    expect(normalizeLinkUrl('team@example.org')).toBe('mailto:team@example.org')
  })

  it('accepts only https image addresses', () => {
    expect(normalizeImageUrl('https://media.example.org/cat.gif')).toBe('https://media.example.org/cat.gif')
    expect(normalizeImageUrl('http://media.example.org/cat.gif')).toBeNull()
    expect(normalizeImageUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(normalizeImageUrl('example.org/cat.gif')).toBeNull()
  })
})

/* Schema round trip (needs a DOM) ------------------------------------------ */

type DomWindow = Record<string, unknown>

async function adoptDom(): Promise<boolean> {
  if (typeof (globalThis as { DOMParser?: unknown }).DOMParser !== 'undefined') return true
  try {
    const name = 'happy-dom'
    const lib = await import(/* @vite-ignore */ name)
    const win: DomWindow = new (lib as { Window: new () => DomWindow }).Window()
    Object.assign(globalThis, {
      window: win, document: win.document, DOMParser: win.DOMParser, Node: win.Node,
    })
    return true
  } catch {
    return false
  }
}

const hasDom = await adoptDom()

const PATH = '2f1c8a4e-0000-4000-8000-000000000001/9b1d.png'
const SIGNED = `https://project.supabase.co/storage/v1/object/sign/rm-images/${PATH}?token=abc`

const BODY = [
  '<h2>Plan -- week 3</h2>',
  '<p>Intro with <strong>bold</strong>, <u>underline</u>, <s>strike</s>, <code>inline</code> and <a href="https://example.org">a link</a>.</p>',
  '<table><tbody>',
  '<tr><th><p>Metric</p></th><th><p>Before</p></th><th><p>After</p></th></tr>',
  '<tr><td><p>Accuracy</p></td><td><p>0.61</p></td><td><p>0.74</p></td></tr>',
  '</tbody></table>',
  '<hr>',
  '<ul data-type="taskList">',
  '<li data-type="taskItem" data-checked="true"><p>Collect pilot data</p></li>',
  '<li data-type="taskItem" data-checked="false"><p>Fit the model</p>',
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Nested step</p></li></ul>',
  '</li></ul>',
  '<blockquote><p>A quoted finding.</p></blockquote>',
  '<pre><code>const x = a -- b</code></pre>',
  `<img src="${SIGNED}" data-object-path="${PATH}">`,
].join('')

type Json = { type: string; attrs?: Record<string, unknown>; content?: Json[]; text?: string }

function collect(node: Json, out: Json[] = []): Json[] {
  out.push(node)
  node.content?.forEach((child) => collect(child, out))
  return out
}

describe.skipIf(!hasDom)('editor schema round trip', () => {
  let toJSON: (html: string) => Json
  let toHTML: (json: Json) => string
  let sanitize: (html: string) => string
  let makeEditor: (html: string) => { getHTML: () => string; destroy: () => void }

  beforeAll(async () => {
    const [editorModule, core, demo] = await Promise.all([
      import('./Editor'), import('@tiptap/core'), import('./demo'),
    ])
    const extensions = editorModule.schemaExtensions() as Parameters<typeof core.generateJSON>[1]
    toJSON = (html) => core.generateJSON(html, extensions) as Json
    toHTML = (json) => core.generateHTML(json as never, extensions)
    sanitize = (html) => demo.sanitize(html)
    makeEditor = (html) => new core.Editor({ extensions: editorModule.schemaExtensions(), content: html })
  })

  it('parses every block the editor offers', () => {
    const nodes = collect(toJSON(BODY))
    const types = new Set(nodes.map((n) => n.type))
    for (const type of ['heading', 'table', 'tableRow', 'tableHeader', 'tableCell', 'horizontalRule',
      'taskList', 'taskItem', 'blockquote', 'codeBlock', 'image', 'paragraph']) {
      expect(types, type).toContain(type)
    }
    const tasks = nodes.filter((n) => n.type === 'taskItem')
    expect(tasks.map((t) => t.attrs?.checked)).toEqual([true, false, false])
    const image = nodes.find((n) => n.type === 'image')
    expect(image?.attrs?.['data-object-path']).toBe(PATH)
    const marks = JSON.stringify(nodes)
    for (const mark of ['bold', 'underline', 'strike', 'code', 'link']) expect(marks).toContain(`"type":"${mark}"`)
  })

  it('serialises to HTML that parses back to the same document', () => {
    const first = toJSON(BODY)
    const html = toHTML(first)
    expect(html).toContain('<table')
    expect(html).toContain('<th')
    expect(html).toContain('<hr>')
    expect(html).toContain('data-type="taskList"')
    expect(html).toContain('data-checked="true"')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<pre><code>')
    expect(html).toContain(`data-object-path="${PATH}"`)
    expect(toJSON(html)).toEqual(first)
  })

  it('survives sanitize() on the way into a read-only view', () => {
    const first = toJSON(BODY)
    const cleaned = sanitize(toHTML(first))
    expect(toJSON(cleaned)).toEqual(first)
  })

  it('keeps double hyphens as typed (no typographic replacement)', () => {
    const html = toHTML(toJSON(BODY))
    expect(html).toContain('Plan -- week 3')
    expect(html).toContain('a -- b')
    expect(html).not.toMatch(/\u2014|\u2013/)   // no em or en dashes
  })

  it('round-trips through a live editor instance', () => {
    const editor = makeEditor(BODY)
    try {
      const html = editor.getHTML()
      expect(toJSON(html)).toEqual(toJSON(BODY))
    } finally {
      editor.destroy()
    }
  })
})

describe.skipIf(!hasDom)('inline-comments view keeps checklist state', () => {
  it('carries data-checked through the allowlist without changing the text', async () => {
    const { parseFormatted, textOfHtml } = await import('./highlight')
    const html = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Done</p></div></li></ul>'
    const fragment = parseFormatted(html)!
    const li = fragment.querySelector('li')!
    expect(li.getAttribute('data-checked')).toBe('true')
    expect(fragment.querySelector('input')).toBeNull()
    expect(textOfHtml(html)).toBe('Done')
  })
})
