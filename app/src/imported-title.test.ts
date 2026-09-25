import { describe, expect, it } from 'vitest'
import { importedDocumentTitle } from './imported-title'

describe('imported titles', () => {
  it('removes legacy labels with broken or normal punctuation', () => {
    for (const dash of ['â€”', '—', '–', ':', '-']) {
      expect(importedDocumentTitle(`Historical Review ${dash} Week #1`, 'review')).toBe('Week #1')
    }
    expect(importedDocumentTitle('Historical RM â€” Initiativeâ€™s Start', 'rm')).toBe('Initiative’s Start')
  })
  it('uses original PDF names and relates reviews without changing custom names', () => {
    const title = 'RM (07/31) - 50,000 Songs'
    expect(importedDocumentTitle(title, 'rm')).toBe(title)
    expect(importedDocumentTitle('Historical Review â€” Week #1', 'review', title)).toBe(`Review of ${title}`)
    expect(importedDocumentTitle('My updated approach', 'rm')).toBe('My updated approach')
  })
})
