// @vitest-environment happy-dom
/**
 * The three remaining UX slices, plus the header role presentation.
 *
 *   npx vitest run src/remaining-ux.test.ts
 *
 * Covered here: version-anchored highlight measurement and segmentation, the
 * selection-to-anchor path against a real DOM, the task-description image
 * contract in the demo engine, and the role badge rules the user asked for.
 * The SQL side of migration 017 is covered by scripts/check-task-images.mjs.
 */
import { describe, expect, it } from 'vitest'
import { accountRoleBadges, roleLabels } from './App'
import { demoAction } from './demo'
import {
  ANCHOR_MAX, anchorError, applyHighlights, mapRenderedText, normalizeText,
  renderFormatted, resolvableSpans, selectionAnchor, textOfHtml,
} from './highlight'
import { seed, TASK_DETAILS_MAX } from './model'
import type { Data, Thread } from './model'

const fresh = (): Data => structuredClone(seed)
const LEAD = 'maya'      // approved, research, leads "sound"
const TEAMMATE = 'alex'  // approved, member of "sound", holds no role
const ADMIN = 'sam'      // approved, operations, so an admin by is_admin()
const file = (type = 'image/png', size = 64, name = 'shot.png') =>
  new File([new Uint8Array(size)], name, { type })

describe('account role presentation', () => {
  it('calls an ordinary approved account a Member, not Approved', () => {
    const badges = accountRoleBadges({ status: 'approved', roles: [] })
    expect(badges.map((b) => b.label)).toEqual(['Member'])
  })

  it('shows the granted role instead of a status for a privileged account', () => {
    expect(accountRoleBadges({ status: 'approved', roles: ['operations'] }).map((b) => b.label))
      .toEqual(['operations'])
    expect(accountRoleBadges({ status: 'approved', roles: ['operations', 'research'] })
      .map((b) => b.label)).toEqual(['research', 'operations'])
  })

  it('deduplicates a role granted more than once', () => {
    expect(roleLabels(['operations', 'operations'])).toEqual(['operations'])
    expect(roleLabels([' Operations ', 'operations', ''])).toEqual(['operations'])
    expect(accountRoleBadges({ status: 'approved', roles: ['operations', 'operations'] }))
      .toHaveLength(1)
  })

  it('still reports a status for an account that is not approved', () => {
    expect(accountRoleBadges({ status: 'pending', roles: [] }).map((b) => b.label))
      .toEqual(['pending'])
    expect(accountRoleBadges({ status: 'suspended', roles: ['research'] }).map((b) => b.label))
      .toEqual(['suspended'])
  })
})

describe('role preview narrows only', () => {
  // The preview applies a role SUBSET to the render flags. These assertions pin
  // the rule the UI relies on: a preview can never name a grant the account does
  // not hold, so it can never display more than the account really has.
  const effective = (actual: string[], preview: string[] | null) => {
    const roles = preview ?? roleLabels(actual)
    return {
      isResearch: roles.includes('research') || roles.includes('admin'),
      isOperations: roles.includes('operations') || roles.includes('admin'),
    }
  }

  it('drops capability when previewing a Member', () => {
    expect(effective(['research'], null)).toEqual({ isResearch: true, isOperations: false })
    expect(effective(['research'], [])).toEqual({ isResearch: false, isOperations: false })
  })

  it('keeps an admin preview of a single role within that role', () => {
    expect(effective(['admin'], ['operations']))
      .toEqual({ isResearch: false, isOperations: true })
  })

  it('offers only roles the account actually holds', () => {
    const offered = (actual: string[]) => roleLabels(actual).filter((r) => r !== 'admin')
    expect(offered(['operations'])).toEqual(['operations'])
    expect(offered([])).toEqual([])
    expect(offered(['research', 'research'])).toEqual(['research'])
  })
})

describe('version-anchored highlight measurement', () => {
  const body = '<p>The pilot ran twice.</p><p>Results were mixed.</p>'
  const text = textOfHtml(body)

  it('reads a version as the text a person sees, with block breaks', () => {
    expect(text).toBe('The pilot ran twice. Results were mixed.')
    expect(normalizeText('  a \n\t b  ')).toBe(' a b ')
  })

  it('accepts a range that matches the version text', () => {
    const start = text.indexOf('ran twice')
    expect(anchorError({ start, end: start + 9, quote: 'ran twice' }, text)).toBeNull()
  })

  it('refuses a range that does not describe the text it claims', () => {
    const start = text.indexOf('ran twice')
    expect(anchorError({ start, end: start + 9, quote: 'ran thrice' }, text)).not.toBeNull()
    expect(anchorError({ start: 0, end: 3, quote: 'ran twice' }, text)).not.toBeNull()
    expect(anchorError({ start: 5, end: 5, quote: '' }, text)).not.toBeNull()
    expect(anchorError({ start: -1, end: 4, quote: 'The ' }, text)).not.toBeNull()
    expect(anchorError({ start: text.length - 1, end: text.length + 6, quote: '.xxxxxx' }, text))
      .not.toBeNull()
    expect(anchorError({ start: 0, end: ANCHOR_MAX + 1, quote: 'x'.repeat(ANCHOR_MAX + 1) }, text))
      .not.toBeNull()
  })

  it('drops an anchor whose text has moved instead of highlighting the wrong words', () => {
    const threads = [
      { id: 'keeps', anchorStart: 4, anchorEnd: 9, quote: text.slice(4, 9) },
      { id: 'moved', anchorStart: 4, anchorEnd: 9, quote: 'xxxxx' },
      { id: 'quote-only', quote: 'ran twice' },
    ]
    expect(resolvableSpans(threads, text).map((s) => s.threadIds[0])).toEqual(['keeps'])
  })

  it('keeps the canonical text identical to what the browser renders', () => {
    // This is the contract the whole feature rests on: textOfHtml is defined as
    // mapRenderedText(parseFormatted(html)).text, so they cannot drift.
    const host = document.createElement('div')
    document.body.append(host)
    try {
      const map = renderFormatted(body, host)!
      expect(map.text).toBe(text)
      expect(map.text).toBe(mapRenderedText(host).text)
    } finally { host.remove() }
  })
})

describe('highlighting formatted content', () => {
  const body = '<h2>Progress</h2><p>The <strong>pilot</strong> ran twice.</p>'
    + '<p><img src="https://x/a.png" data-object-path="i/a.png" alt="plot"></p>'
    + '<ul><li>Results were mixed.</li></ul>'
  let host: HTMLDivElement

  const render = () => {
    host = document.createElement('div')
    document.body.append(host)
    return renderFormatted(body, host)!
  }

  it('preserves formatting, images and text when nothing is anchored', () => {
    const map = render()
    try {
      expect(host.querySelector('h2')?.textContent).toBe('Progress')
      expect(host.querySelector('strong')?.textContent).toBe('pilot')
      expect(host.querySelector('li')?.textContent).toBe('Results were mixed.')
      const img = host.querySelector('img')!
      expect(img.getAttribute('data-object-path')).toBe('i/a.png')
      expect(img.getAttribute('src')).toBe('https://x/a.png')
      expect(map.text).toBe('Progress The pilot ran twice. Results were mixed.')
    } finally { host.remove() }
  })

  it('draws a mark over the anchored passage without disturbing the markup', () => {
    const map = render()
    try {
      const start = map.text.indexOf('ran twice')
      const drawn = applyHighlights([{ start, end: start + 9, threadIds: ['t1'] }], map)
      expect(drawn).toBeGreaterThan(0)
      const marks = [...host.querySelectorAll('mark.hl')]
      expect(marks.map((m) => m.textContent).join('')).toBe('ran twice')
      expect(marks[0].getAttribute('data-threads')).toBe('t1')
      expect(marks[0].getAttribute('role')).toBe('button')
      expect(marks[0].getAttribute('tabindex')).toBe('0')
      // Formatting, the image, and the text itself all survive, and the canonical
      // text is unchanged by the wrapping.
      expect(host.querySelector('strong')?.textContent).toBe('pilot')
      expect(host.querySelector('img')?.getAttribute('data-object-path')).toBe('i/a.png')
      expect(mapRenderedText(host).text).toBe(map.text)
    } finally { host.remove() }
  })

  it('marks a passage that crosses an inline element', () => {
    const map = render()
    try {
      const start = map.text.indexOf('The pilot ran')
      applyHighlights([{ start, end: start + 13, threadIds: ['t1'] }], map)
      const marks = [...host.querySelectorAll('mark.hl')]
      // Split across the <strong>, so more than one mark, same total text.
      expect(marks.length).toBeGreaterThan(1)
      expect(marks.map((m) => m.textContent).join('')).toBe('The pilotran ')
      expect(host.querySelector('strong mark.hl')).not.toBeNull()
      expect(mapRenderedText(host).text).toBe(map.text)
    } finally { host.remove() }
  })

  it('lists both threads on the overlap of two highlights', () => {
    const map = render()
    try {
      const a = map.text.indexOf('The pilot')
      applyHighlights([
        { start: a, end: a + 9, threadIds: ['t1'] },
        { start: a + 4, end: a + 20, threadIds: ['t2'] },
      ], map)
      const both = [...host.querySelectorAll('mark.hl')]
        .find((m) => (m.getAttribute('data-threads') ?? '').split(' ').length === 2)
      expect(both).not.toBeUndefined()
      expect(both!.getAttribute('data-threads')).toBe('t1 t2')
      expect(mapRenderedText(host).text).toBe(map.text)
    } finally { host.remove() }
  })

  it('drops scripts, handlers and unsafe urls instead of rendering them', () => {
    host = document.createElement('div')
    document.body.append(host)
    try {
      renderFormatted(
        '<p onclick="alert(1)">text</p><script>alert(2)</script>'
        + '<iframe src="https://evil"></iframe>'
        + '<a href="javascript:alert(3)">link</a>'
        + '<img src="data:image/png;base64,AAAA">',
        host,
      )
      expect(host.querySelector('script')).toBeNull()
      expect(host.querySelector('iframe')).toBeNull()
      expect(host.querySelector('p')?.hasAttribute('onclick')).toBe(false)
      expect(host.querySelector('a')?.hasAttribute('href')).toBe(false)
      expect(host.querySelector('img')?.hasAttribute('src')).toBe(false)
      expect(host.textContent).not.toContain('alert(2)')
      // An unknown wrapper loses the tag but keeps the words it held.
      expect(host.textContent).toContain('text')
      expect(host.textContent).toContain('link')
    } finally { host.remove() }
  })
})

describe('measuring a live selection over formatted content', () => {
  const body = '<h2>Progress</h2><p>The <strong>pilot</strong> ran twice.</p>'
  let host: HTMLDivElement

  const select = (range: Range) => {
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  }

  it('converts a selection through the index map, not by string matching', () => {
    host = document.createElement('div')
    document.body.append(host)
    try {
      const map = renderFormatted(body, host)!
      // "ran twice." lives in the text node after the <strong>.
      const tail = [...host.querySelectorAll('p')][0].lastChild as Text
      const offset = tail.data.indexOf('ran')
      const range = document.createRange()
      range.setStart(tail, offset)
      range.setEnd(tail, offset + 9)
      select(range)
      const anchor = selectionAnchor(host, map)
      expect(anchor).not.toBeNull()
      expect(anchor!.quote).toBe('ran twice')
      expect(map.text.slice(anchor!.start, anchor!.end)).toBe('ran twice')
      // The quote comes from the canonical text, so validation always agrees.
      expect(anchorError(anchor!, map.text)).toBeNull()
    } finally {
      window.getSelection()?.removeAllRanges()
      host.remove()
    }
  })

  it('measures a selection that spans a block boundary', () => {
    host = document.createElement('div')
    document.body.append(host)
    try {
      const map = renderFormatted(body, host)!
      const heading = host.querySelector('h2')!.firstChild as Text
      const strong = host.querySelector('strong')!.firstChild as Text
      const range = document.createRange()
      range.setStart(heading, 0)
      range.setEnd(strong, 5)
      select(range)
      const anchor = selectionAnchor(host, map)
      expect(anchor).not.toBeNull()
      // The collapsed block gap counts as exactly one character.
      expect(anchor!.quote).toBe('Progress The pilot')
      expect(anchorError(anchor!, map.text)).toBeNull()
    } finally {
      window.getSelection()?.removeAllRanges()
      host.remove()
    }
  })

  it('ignores a collapsed selection and one outside the container', () => {
    host = document.createElement('div')
    const other = document.createElement('div')
    other.textContent = 'outside'
    document.body.append(host, other)
    try {
      const map = renderFormatted(body, host)!
      window.getSelection()?.removeAllRanges()
      expect(selectionAnchor(host, map)).toBeNull()
      const range = document.createRange()
      range.selectNodeContents(other)
      select(range)
      expect(selectionAnchor(host, map)).toBeNull()
    } finally {
      window.getSelection()?.removeAllRanges()
      host.remove(); other.remove()
    }
  })

  it('refuses an element-boundary selection instead of guessing its offsets', () => {
    host = document.createElement('div')
    document.body.append(host)
    try {
      const map = renderFormatted(body, host)!
      const paragraph = host.querySelector('p')!
      const range = document.createRange()
      range.setStart(paragraph, 0)
      range.setEnd(paragraph, paragraph.childNodes.length)
      select(range)
      expect(selectionAnchor(host, map)).toBeNull()
    } finally {
      window.getSelection()?.removeAllRanges()
      host.remove()
    }
  })
})

describe('anchored comments in the demo engine', () => {
  const anchorOn = async (data: Data, extra: Record<string, unknown>) => {
    const doc = data.documents.find((d) => d.id === 'rm-sound')!
    const text = textOfHtml(doc.body)
    const start = text.indexOf('first prototype')
    return demoAction(data, TEAMMATE, 'addThread', {
      documentId: 'rm-sound', version: 1, quote: text.slice(start, start + 15),
      anchorStart: start, anchorEnd: start + 15, body: 'Say how it was measured.', ...extra,
    })
  }

  it('stores the range so the highlight can be drawn', async () => {
    const after = await anchorOn(fresh(), {})
    const thread = after.threads.find((t) => t.quote === 'first prototype') as Thread
    expect(thread.anchorStart).toBeGreaterThanOrEqual(0)
    expect(thread.anchorEnd! - thread.anchorStart!).toBe(15)
    expect(thread.version).toBe(1)
    const text = textOfHtml(after.documents.find((d) => d.id === 'rm-sound')!.body)
    expect(resolvableSpans([thread], text)).toHaveLength(1)
  })

  it('refuses a range that does not match the selected passage', async () => {
    await expect(anchorOn(fresh(), { anchorEnd: 9999 })).rejects.toThrow()
    await expect(anchorOn(fresh(), { quote: 'not in the text' })).rejects.toThrow()
  })

  it('keeps quote-only comments working', async () => {
    const after = await demoAction(fresh(), TEAMMATE, 'addThread',
      { documentId: 'rm-sound', version: 1, quote: 'first prototype', body: 'Looks good.' })
    const thread = after.threads.find((t) => t.messages[0]?.body === 'Looks good.')!
    expect(thread.anchorStart).toBeUndefined()
  })
})

describe('task description images in the demo engine', () => {
  const taskId = () => fresh().initiatives.find((i) => i.id === 'sound')!.tasks[0].id

  it('derives a durable object path from the initiative and the validated type', async () => {
    const payload: any = { taskId: taskId(), file: file('image/png', 64, 'evil.png/../x.svg?a=1') }
    await demoAction(fresh(), LEAD, 'uploadTaskImage', payload)
    expect(payload.result.path.split('/')).toHaveLength(2)
    expect(payload.result.path.startsWith('sound/')).toBe(true)
    expect(payload.result.path.endsWith('.png')).toBe(true)
    expect(payload.result.path).not.toMatch(/[?#]|\.\./)
  })

  it('limits attaching to whoever may edit the description', async () => {
    // A teammate who is not the lead has status-only authority over a task, so
    // it cannot change the description or its images.
    await expect(demoAction(fresh(), TEAMMATE, 'uploadTaskImage',
      { taskId: taskId(), file: file() })).rejects.toThrow(/lead or an admin/i)
    // An admin may, which matches update_task and has since migration 014.
    const payload: any = { taskId: taskId(), file: file() }
    await demoAction(fresh(), ADMIN, 'uploadTaskImage', payload)
    expect(payload.result.path.startsWith('sound/')).toBe(true)
  })

  it('refuses a type outside the image allowlist', async () => {
    await expect(demoAction(fresh(), LEAD, 'uploadTaskImage',
      { taskId: taskId(), file: file('image/svg+xml', 64, 'x.svg') })).rejects.toThrow()
  })

  it('will not remove an image the description still shows', async () => {
    const id = taskId()
    const path = 'sound/abc.png'
    let data = await demoAction(fresh(), LEAD, 'updateTask', {
      initiativeId: 'sound', taskId: id, title: 'Document the first prototype',
      description: `<p><img src="" data-object-path="${path}"></p>`, status: 'planned',
    })
    await expect(demoAction(data, LEAD, 'detachTaskImage', { taskId: id, objectPath: path }))
      .rejects.toThrow(/still shows/i)
    // Once the reference leaves the text, the image can go.
    data = await demoAction(data, LEAD, 'updateTask', {
      initiativeId: 'sound', taskId: id, title: 'Document the first prototype',
      description: '<p>No image.</p>', status: 'planned',
    })
    await expect(demoAction(data, LEAD, 'detachTaskImage', { taskId: id, objectPath: path }))
      .resolves.toBeTruthy()
  })

  it('accepts a description long enough for markup with images', async () => {
    const id = taskId()
    const ok = await demoAction(fresh(), LEAD, 'updateTask', {
      initiativeId: 'sound', taskId: id, title: 'Document the first prototype',
      description: '<p>' + 'x'.repeat(3000) + '</p>', status: 'planned',
    })
    expect(ok.initiatives.find((i) => i.id === 'sound')!.tasks
      .find((t) => t.id === id)!.description.length).toBeGreaterThan(2000)
    await expect(demoAction(fresh(), LEAD, 'updateTask', {
      initiativeId: 'sound', taskId: id, title: 'Too long',
      description: 'x'.repeat(TASK_DETAILS_MAX + 1), status: 'planned',
    })).rejects.toThrow(/at most/i)
  })
})
