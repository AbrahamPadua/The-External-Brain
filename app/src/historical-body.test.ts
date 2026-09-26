// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { presentHistoricalBody } from './historical-body'

const RAW_TEXT = `--- Source RM: RM 8 | Author: Thejo Tattala ---
RM Aug 23-28

Initiative: EEG-Controlled Humanoid Robot     Author:
Thejo Tattala      Status: Submitted

Our main obstacle this week is finding time to test the grasping controller before the demo.`

describe('presentHistoricalBody', () => {
  it('turns a single <pre>-wrapped Notion/PDF dump into real paragraphs and a metadata block', () => {
    const out = presentHistoricalBody(`<pre>${RAW_TEXT}</pre>`)
    expect(out).not.toContain('<pre')
    expect(out).not.toContain('<code')
    expect(out).not.toContain('---')
    // Metadata is a compact, muted block with bold labels, not the raw banner.
    expect(out).toContain('<blockquote>')
    expect(out).toContain('<strong>Source RM:</strong> RM 8')
    expect(out).toContain('<strong>Author:</strong> Thejo Tattala')
    expect(out).toContain('<strong>Initiative:</strong> EEG-Controlled Humanoid Robot')
    expect(out).toContain('<strong>Status:</strong> Submitted')
    // The hard-wrapped body sentence is rejoined into one flowing paragraph.
    expect(out).toContain(
      '<p>Our main obstacle this week is finding time to test the grasping controller before the demo.</p>',
    )
  })

  it('produces the same result when each source line was wrapped as its own <p><code> strip', () => {
    const perLine = RAW_TEXT.split('\n').map((line) => `<p><code>${line}</code></p>`).join('')
    const fromPre = presentHistoricalBody(`<pre>${RAW_TEXT}</pre>`)
    const fromPerLine = presentHistoricalBody(perLine)
    expect(fromPerLine).toBe(fromPre)
  })

  it('leaves already-clean historical HTML (e.g. a repaired import) untouched', () => {
    const clean = '<h2>Progress</h2><p>Transcribed from the archived workspace.</p>'
    expect(presentHistoricalBody(clean)).toBe(clean)
  })

  it('leaves ordinary non-imported HTML untouched', () => {
    const html = '<p>Just a normal update with no dump formatting.</p>'
    expect(presentHistoricalBody(html)).toBe(html)
  })

  it('is idempotent: re-running on its own output is a no-op', () => {
    const once = presentHistoricalBody(`<pre>${RAW_TEXT}</pre>`)
    expect(presentHistoricalBody(once)).toBe(once)
  })

  it('turns bulleted and numbered lines into real lists', () => {
    const raw = `<pre>--- Source RM: RM 9 | Author: Jane Doe ---

Tasks remaining:

- Fix the sensor calibration
- Write the report
* Also check power draw

1. Finish calibration
2. Ship report</pre>`
    const out = presentHistoricalBody(raw)
    expect(out).toContain('<ul><li>Fix the sensor calibration</li><li>Write the report</li><li>Also check power draw</li></ul>')
    expect(out).toContain('<ol><li>Finish calibration</li><li>Ship report</li></ol>')
    expect(out).toContain('<p>Tasks remaining:</p>')
  })

  it('splits a lead-in line from the list that follows it with no blank line between them', () => {
    const raw = `<pre>--- Source RM: RM 10 | Author: Jane Doe ---

Next steps:
- Finish the grasp classifier
- Calibrate the wrist servo
- Record a short demo clip</pre>`
    const out = presentHistoricalBody(raw)
    expect(out).toContain('<p>Next steps:</p>')
    expect(out).toContain(
      '<ul><li>Finish the grasp classifier</li><li>Calibrate the wrist servo</li><li>Record a short demo clip</li></ul>',
    )
    expect(out).not.toContain('Next steps: - Finish')
  })

  it('escapes HTML in the source text and keeps URLs as real links', () => {
    const raw = `<pre>--- Source RM: RM 3 | Author: A &amp; B ---

R&amp;D notes: see https://example.com/report?a=1&amp;b=2 for the full write-up.</pre>`
    const out = presentHistoricalBody(raw)
    // The ampersand round-trips through the DOM (unescaped) and back out
    // (re-escaped) rather than ending up literal or double-escaped.
    expect(out).toContain('<strong>Author:</strong> A &amp; B')
    expect(out).toContain('R&amp;D notes')
    expect(out).not.toContain('R&D notes')
    expect(out).toContain('<a href="https://example.com/report?a=1&amp;b=2">https://example.com/report?a=1&amp;b=2</a>')
  })

  it('keeps an image reference intact by object path', () => {
    const raw = '<pre>--- Source RM: RM 4 | Author: A ---</pre><p><code>See the chart below.</code></p>' +
      '<img data-object-path="ini/1.png" alt="chart">'
    const out = presentHistoricalBody(raw)
    expect(out).toContain('<img data-object-path="ini/1.png" alt="chart">')
  })

  it('handles an empty or blank body without throwing', () => {
    expect(presentHistoricalBody('<pre></pre>')).toBe('<p></p>')
    expect(presentHistoricalBody('')).toBe('')
  })
})
