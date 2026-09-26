/**
 * Version-anchored highlights drawn over FORMATTED Roast Me content.
 *
 * A thread records the character range of the passage it is about, measured in
 * the normalised text of one submitted version. The earlier implementation got
 * exactness by rendering plain text and throwing the formatting away; this one
 * keeps headings, emphasis, lists and inline images and still measures exactly,
 * because the text contract and the rendering come from the SAME walk:
 *
 *   parseFormatted(html)  -> an allowlisted DocumentFragment
 *   mapRenderedText(root) -> { text, slices }   the canonical text + a per-text-node
 *                                               index map back into it
 *   textOfHtml(html)      = mapRenderedText(parseFormatted(html)).text
 *
 * Because `textOfHtml` is defined as that composition, the offsets a highlight is
 * stored with and the offsets the browser is showing cannot drift. Selections are
 * converted through the same map rather than by matching strings, so nothing here
 * guesses where a quote might be.
 *
 * Safety: markup never reaches `innerHTML`. It is parsed inert by DOMParser into
 * a detached document, then cloned element by element through an allowlist that
 * drops unknown tags, every unknown attribute (so every `on*` handler), and any
 * `href`/`src` that is not http(s), blob: or empty. Highlight marks are built
 * with createElement/createTextNode over the node's own characters, so the
 * surrounding markup and the images are untouched.
 *
 * Because the rendering is our own DOM, nothing is injected into ProseMirror's
 * managed content, whose mutation observer would fight it.
 */

/** The longest passage a highlight may cover, matching comment_threads_anchor_range. */
export const ANCHOR_MAX = 2000

export type Anchor = { start: number; end: number; quote: string }
export type HighlightSpan = { start: number; end: number; threadIds: string[] }

/** One rendered text node and, per character, its index in the canonical text. */
export type TextSlice = { node: Text; map: number[] }
export type TextMap = { text: string; slices: TextSlice[] }

/**
 * Elements kept when cloning, with the attributes each may keep. Anything absent
 * is dropped, which is what removes scripts, styles, iframes, event handlers and
 * any attribute added later that nobody vetted.
 */
const ALLOWED: Record<string, readonly string[]> = {
  P: [], DIV: [], SPAN: [], BR: [], HR: [],
  STRONG: [], B: [], EM: [], I: [], U: [], S: [], DEL: [], MARK: [], SMALL: [], SUB: [], SUP: [],
  H1: [], H2: [], H3: [], H4: [], H5: [], H6: [],
  // data-type / data-checked mark checklists; they carry no text, so they do not
  // change the canonical text, and they let a checklist render as one.
  UL: ['data-type'], OL: ['start'], LI: ['data-type', 'data-checked'],
  BLOCKQUOTE: [], CODE: [], PRE: [], FIGURE: [], FIGCAPTION: [],
  TABLE: [], THEAD: [], TBODY: [], TR: [], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'],
  IMG: ['alt', 'title', 'width', 'height', 'data-object-path', 'src'],
  A: ['title', 'href'],
}

/** Tags that read as a gap, so they contribute one space to the canonical text. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'BR', 'HR', 'TR', 'TABLE', 'PRE', 'FIGURE', 'FIGCAPTION', 'SECTION',
])

/**
 * Elements whose CONTENT is dropped too. An unknown wrapper keeps its words, but
 * a script's or a style's text is not prose and must not surface as visible text.
 */
const DROP_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT'])

const SAFE_URL = /^(?:https?:|blob:|#|\/|$)/i

/** Collapse runs of whitespace and control characters into single spaces. */
export function normalizeText(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ')
}

const safeUrl = (value: string | null): string | null => {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  return SAFE_URL.test(trimmed) ? trimmed : null
}

/**
 * Parse markup and clone it through the allowlist. The result is detached, so it
 * has loaded nothing and run nothing by the time it is returned.
 */
export function parseFormatted(html: string): DocumentFragment | null {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') return null
  // Remove resource-bearing active containers before parsing as well as during
  // cloning. Browsers treat DOMParser documents as inert for script execution,
  // but some engines may still fetch image/frame resources while parsing.
  const inertInput = String(html ?? '')
    .replace(/<\s*(script|style|iframe|object|embed|template|noscript)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|template|noscript)\b[^>]*>/gi, '')
  const parsed = new DOMParser().parseFromString(inertInput, 'text/html')
  const out = document.createDocumentFragment()
  const clone = (source: Node, target: Node) => {
    source.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        target.appendChild(document.createTextNode(child.nodeValue ?? ''))
        return
      }
      if (child.nodeType !== 1) return
      const element = child as Element
      if (DROP_CONTENT.has(element.tagName)) return
      const allowed = ALLOWED[element.tagName]
      if (!allowed) {
        // Unknown wrapper: keep what it contained, drop the element itself, so
        // text is never silently lost and the tag can do nothing.
        clone(element, target)
        return
      }
      const copy = document.createElement(element.tagName.toLowerCase())
      for (const name of allowed) {
        const value = element.getAttribute(name)
        if (value === null) continue
        if (name === 'href' || name === 'src') {
          const url = safeUrl(value)
          if (url === null) continue
          copy.setAttribute(name, url)
          continue
        }
        copy.setAttribute(name, value)
      }
      if (copy.tagName === 'A') copy.setAttribute('rel', 'noreferrer noopener')
      clone(element, copy)
      target.appendChild(copy)
    })
  }
  clone(parsed.body, out)
  return out
}

/**
 * Walk rendered nodes and build the canonical text together with, for every
 * character of every text node, the index it occupies in that text (-1 when the
 * character was collapsed away). This single walk is what both the stored
 * offsets and the drawn highlights are defined against.
 */
export function mapRenderedText(root: Node): TextMap {
  const slices: TextSlice[] = []
  let text = ''
  let pendingSpace = false
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      const raw = node.nodeValue ?? ''
      const map: number[] = []
      let contributes = false
      for (const ch of raw) {
        if (/\s/.test(ch)) {
          // A leading run is dropped entirely; otherwise remember one space and
          // emit it only when real text follows, which is trim + collapse in one pass.
          if (text.length) pendingSpace = true
          map.push(-1)
          continue
        }
        if (pendingSpace) { text += ' '; pendingSpace = false }
        map.push(text.length)
        text += ch
        contributes = true
      }
      if (contributes) slices.push({ node: node as Text, map })
      return
    }
    if (node.nodeType !== 1) return
    node.childNodes.forEach(walk)
    if (BLOCK_TAGS.has((node as Element).tagName) && text.length) pendingSpace = true
  }
  root.childNodes.forEach(walk)
  return { text, slices }
}

/**
 * The canonical text of a stored body. Defined as the composition above, so the
 * back end's length check, the demo engine's validation and the browser's
 * rendering all agree by construction.
 *
 * Without a DOM this falls back to stripping tags, which is close but NOT
 * guaranteed identical; anchoring is a browser feature and always has a DOM.
 */
export function textOfHtml(html: string): string {
  const fragment = parseFormatted(html)
  if (!fragment) return normalizeText(String(html ?? '').replace(/<[^>]*>/g, ' ')).trim()
  return mapRenderedText(fragment).text
}

/** Replace a container's children with freshly parsed, allowlisted markup. */
export function renderFormatted(html: string, into: HTMLElement): TextMap | null {
  const fragment = parseFormatted(html)
  if (!fragment) return null
  into.replaceChildren(fragment)
  return mapRenderedText(into)
}

/**
 * Validate a proposed anchor against the version text it claims to describe.
 * The same conditions are enforced again by add_anchored_comment, so a client
 * that skips this is refused rather than trusted.
 */
export function anchorError(anchor: Anchor, versionText: string): string | null {
  const { start, end, quote } = anchor
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 'Select a passage to comment on.'
  if (start < 0 || end <= start) return 'Select a passage to comment on.'
  if (!quote.length) return 'Select a passage to comment on.'
  if (end - start !== quote.length) return 'That selection could not be measured; try selecting it again.'
  if (end - start > ANCHOR_MAX) return `Select at most ${ANCHOR_MAX} characters.`
  if (end > versionText.length) return 'That selection is outside this version.'
  if (versionText.slice(start, end) !== quote) {
    return 'That selection no longer matches this version; try selecting it again.'
  }
  return null
}

/**
 * Anchors that still match the version they were recorded against. A thread whose
 * text has moved is dropped from the highlight layer rather than drawn over the
 * wrong words; the thread itself is still listed beside the document.
 */
export function resolvableSpans(
  threads: { id: string; anchorStart?: number; anchorEnd?: number; quote: string }[],
  versionText: string,
): HighlightSpan[] {
  const spans: HighlightSpan[] = []
  for (const thread of threads) {
    const { anchorStart: start, anchorEnd: end } = thread
    if (start === undefined || end === undefined) continue
    const quote = normalizeText(thread.quote)
    if (anchorError({ start, end, quote }, versionText)) continue
    spans.push({ start, end, threadIds: [thread.id] })
  }
  return spans.sort((a, b) => a.start - b.start || b.end - a.end)
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i])

/**
 * Wrap every highlighted range in `<mark>` elements, in place.
 *
 * Each text node is rebuilt once from its own characters, so overlapping spans
 * produce one mark per distinct covering set and no text is duplicated or lost.
 * The map is consumed: re-map afterwards for anything that needs fresh slices.
 */
export function applyHighlights(spans: HighlightSpan[], map: TextMap): number {
  if (!spans.length) return 0
  let drawn = 0
  for (const slice of map.slices) {
    const from = slice.map.find((i) => i >= 0) ?? -1
    const to = [...slice.map].reverse().find((i) => i >= 0) ?? -1
    if (from < 0) continue
    const covering = spans.filter((s) => s.start <= to && s.end > from)
    if (!covering.length) continue

    const raw = slice.node.data
    // Per character, the threads covering it. A collapsed character inherits from
    // its neighbour so a mark is not split at a space inside the range.
    const ids: string[][] = []
    let carried: string[] = []
    for (let i = 0; i < raw.length; i += 1) {
      const at = slice.map[i]
      if (at < 0) { ids.push(carried); continue }
      carried = covering.filter((s) => s.start <= at && at < s.end).flatMap((s) => s.threadIds)
      ids.push(carried)
    }

    const doc = slice.node.ownerDocument ?? document
    const fragment = doc.createDocumentFragment()
    let i = 0
    while (i < raw.length) {
      const current = ids[i] ?? []
      let j = i + 1
      while (j < raw.length && sameIds(ids[j] ?? [], current)) j += 1
      const chunk = raw.slice(i, j)
      if (current.length) {
        const mark = doc.createElement('mark')
        mark.className = 'hl'
        mark.setAttribute('data-threads', current.join(' '))
        mark.setAttribute('tabindex', '0')
        mark.setAttribute('role', 'button')
        mark.setAttribute('aria-expanded', 'false')
        mark.setAttribute('aria-label',
          `${chunk} - ${current.length} comment${current.length === 1 ? '' : 's'}`)
        mark.appendChild(doc.createTextNode(chunk))
        fragment.appendChild(mark)
        drawn += 1
      } else {
        fragment.appendChild(doc.createTextNode(chunk))
      }
      i = j
    }
    slice.node.replaceWith(fragment)
  }
  return drawn
}

/** The canonical index a DOM position sits at, or null when it is not in the map. */
function indexOfPosition(map: TextMap, node: Node, offset: number, edge: 'start' | 'end'): number | null {
  const slice = map.slices.find((s) => s.node === node)
  if (slice) {
    if (edge === 'start') {
      for (let i = offset; i < slice.map.length; i += 1) if (slice.map[i] >= 0) return slice.map[i]
      // Everything after the caret collapsed away: fall through to the next slice.
      const position = map.slices.indexOf(slice)
      for (let s = position + 1; s < map.slices.length; s += 1) {
        const next = map.slices[s].map.find((i) => i >= 0)
        if (next !== undefined && next >= 0) return next
      }
      return map.text.length
    }
    for (let i = Math.min(offset, slice.map.length) - 1; i >= 0; i -= 1) {
      if (slice.map[i] >= 0) return slice.map[i] + 1
    }
    const position = map.slices.indexOf(slice)
    for (let s = position - 1; s >= 0; s -= 1) {
      const previous = [...map.slices[s].map].reverse().find((i) => i >= 0)
      if (previous !== undefined && previous >= 0) return previous + 1
    }
    return 0
  }
  // Browser selections normally end in Text nodes. An element-boundary offset
  // refers to a child slot, not to the whole element; treating the element as a
  // range would silently broaden the quote. Refuse that unusual selection and
  // let the person select again instead of guessing a position.
  return null
}

/**
 * The anchor for the current selection, derived through the map rather than by
 * matching the selection's string. The quote is taken from the canonical text, so
 * it always agrees with the offsets - there is no approximate match anywhere.
 */
export function selectionAnchor(container: HTMLElement, map: TextMap): Anchor | null {
  const selection = typeof window === 'undefined' ? null : window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) return null
  const start = indexOfPosition(map, range.startContainer, range.startOffset, 'start')
  const end = indexOfPosition(map, range.endContainer, range.endOffset, 'end')
  if (start === null || end === null || end <= start) return null
  return { start, end, quote: map.text.slice(start, end) }
}
