/**
 * Presentation-only reformatting of a historical (imported) document body.
 *
 * The pre-repair import stored a Notion/PDF text dump verbatim, wrapped in
 * `<pre>`/`<code>` (a bare `--- Source RM: ... | Author: ... ---` banner,
 * `Label: value` metadata lines hard-wrapped mid-word, blank-line-separated
 * paragraphs) so it read like source code: monospace, one highlighted strip
 * per original line, no real paragraphs. `presentHistoricalBody` turns that
 * shape into ordinary prose - real paragraphs, lists, a small metadata block -
 * without touching the stored source. It is a pure function: same input,
 * same output, called only when rendering, never on the way into storage.
 *
 * A document already stored as clean HTML (no `<pre>`/`<code>`, no banner -
 * i.e. one already repaired, or user-authored) is returned unchanged: this
 * function only unwraps the raw-dump shape, it never reflows real markup.
 */

const escapeHtml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttr = (s: string): string => escapeHtml(s).replaceAll('"', '&quot;')

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

/** Escape plain text and turn any http(s) URL within it into a real link. */
function linkify(raw: string): string {
  let out = ''
  let last = 0
  for (const m of raw.matchAll(URL_RE)) {
    const start = m.index ?? 0
    out += escapeHtml(raw.slice(last, start))
    let url = m[0]
    let trail = ''
    // A URL at the end of a sentence should not swallow its punctuation.
    while (url && /[.,;:!?)]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1) }
    if (url) out += `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`
    out += escapeHtml(trail)
    last = start + m[0].length
  }
  out += escapeHtml(raw.slice(last))
  return out
}

/** Whether a body looks like the raw import dump rather than real HTML. */
function looksLikeRawImport(html: string): boolean {
  return /<pre[\s>]|<code[\s>]/i.test(html) || /-{2,}\s*Source\s+(RM|review)\b/i.test(html)
}

/**
 * Flatten stored markup into plain lines, one per original line break,
 * preserving blank lines as paragraph separators. Any `<img data-object-path>`
 * is kept verbatim via a placeholder so image references are never altered.
 */
function extractLines(html: string, images: string[]): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style').forEach((n) => n.remove())
  doc.querySelectorAll('img[data-object-path]').forEach((img) => {
    const marker = `@@HISTORICAL_IMG_${images.length}@@`
    images.push(img.outerHTML)
    img.replaceWith(doc.createTextNode(marker))
  })
  doc.querySelectorAll('br').forEach((n) => n.replaceWith('\n'))
  doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,tr,pre,td,th').forEach((n) => n.append('\n'))
  const text = (doc.body.textContent ?? '').replace(/ /g, ' ')
  return text.split(/\r\n?|\n/)
}

/** Consecutive non-blank raw lines, in order, blank lines dropped as separators. */
function groupParagraphs(lines: string[]): string[][] {
  const groups: string[][] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length) { groups.push(current); current = [] }
    } else {
      current.push(line)
    }
  }
  if (current.length) groups.push(current)
  return groups
}

const LABEL_RE = /(?:^|\s)([A-Z][A-Za-z]{1,20}):(?=\s|$)/g

/** Rendered inner HTML for a metadata group, or null if it is not one. */
function metadataInner(rawLines: string[]): string | null {
  const joined = rawLines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const banner = joined.match(/^-{2,}\s*(.*?)\s*-{2,}\s*(.*)$/)
  const segments: string[] = []
  if (banner) {
    const [, inner, trailing] = banner
    segments.push(...inner.split('|').map((s) => s.trim()).filter(Boolean))
    if (trailing.trim()) segments.push(trailing.trim())
  } else {
    const matches = [...joined.matchAll(LABEL_RE)]
    if (matches.length < 2) return null
    matches.forEach((m, i) => {
      const start = (m.index ?? 0) + m[0].length
      const end = i + 1 < matches.length ? matches[i + 1].index : joined.length
      const label = m[1].trim()
      const value = joined.slice(start, end).trim()
      segments.push(value ? `${label}: ${value}` : label)
    })
  }
  if (!segments.length) return null
  return segments
    .map((seg) => {
      const kv = seg.match(/^([A-Za-z][A-Za-z ]{0,24}):\s*(.*)$/)
      return kv ? `<strong>${escapeHtml(kv[1].trim())}:</strong> ${linkify(kv[2].trim())}` : linkify(seg)
    })
    .join(' · ')
}

const LIST_MARKER_RE = /^(?:[-*•]|\d+\.)\s+/

/** Rendered `<ul>`/`<ol>` for a group whose first line is a list item, or null. */
function renderList(rawLines: string[]): string {
  const trimmed = rawLines.map((l) => l.trim()).filter(Boolean)
  const ordered = /^\d+\./.test(trimmed[0] ?? '')
  const items: string[] = []
  for (const line of trimmed) {
    if (LIST_MARKER_RE.test(line)) items.push(line.replace(LIST_MARKER_RE, ''))
    else if (items.length) items[items.length - 1] += ' ' + line
    else items.push(line) // no marker yet: keep rather than drop
  }
  const tag = ordered ? 'ol' : 'ul'
  return `<${tag}>${items.map((i) => `<li>${linkify(i.trim())}</li>`).join('')}</${tag}>`
}

/** A prose paragraph: hard-wrapped lines rejoined into one flowing line. */
function proseParagraph(rawLines: string[]): string {
  const text = rawLines.map((l) => l.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  return `<p>${linkify(text)}</p>`
}

export function presentHistoricalBody(html: string): string {
  const value = String(html ?? '')
  if (!looksLikeRawImport(value)) return value
  const images: string[] = []
  const groups = groupParagraphs(extractLines(value, images))
  if (!groups.length) return '<p></p>'
  const blocks: string[] = []
  let metaBuffer: string[] = []
  const flushMeta = () => {
    if (metaBuffer.length) blocks.push(`<blockquote>${metaBuffer.map((m) => `<p>${m}</p>`).join('')}</blockquote>`)
    metaBuffer = []
  }
  for (const group of groups) {
    const meta = metadataInner(group)
    if (meta !== null) { metaBuffer.push(meta); continue }
    flushMeta()
    // A lead-in line ("Next steps:") often shares its paragraph with the list
    // that follows it, with no blank line in between - split the two rather
    // than flattening the whole group into one run-on prose paragraph.
    const markerIdx = group.findIndex((l) => LIST_MARKER_RE.test(l.trim()))
    if (markerIdx === -1) { blocks.push(proseParagraph(group)); continue }
    const prefix = group.slice(0, markerIdx)
    if (prefix.some((l) => l.trim())) blocks.push(proseParagraph(prefix))
    blocks.push(renderList(group.slice(markerIdx)))
  }
  flushMeta()
  let result = blocks.join('')
  images.forEach((tag, i) => { result = result.split(`@@HISTORICAL_IMG_${i}@@`).join(tag) })
  return result || '<p></p>'
}
