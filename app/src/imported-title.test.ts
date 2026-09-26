import { describe, expect, it } from 'vitest'
import { cleanImportedText, importedDocumentTitle, presentDocumentTitle, repairMojibake } from './imported-title'

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

  describe('double-encoded (mojibake) repair', () => {
    it('repairs single-level em dash mojibake', () => {
      expect(cleanImportedText('â€”')).toBe('—')
    })
    it('repairs double-encoded em dash with U+009D', () => {
      expect(cleanImportedText('Ã¢â‚¬â€\u009D')).toBe('—')
    })
    it('repairs double-encoded em dash with dropped 0x9D', () => {
      expect(cleanImportedText('Ã¢â‚¬â€ not stated')).toBe('— not stated')
    })
    it('repairs double-encoded right single quotation mark', () => {
      expect(cleanImportedText('Ã¢â‚¬â„¢')).toBe('’')
    })
    it('repairs double-encoded left double quotation mark', () => {
      expect(cleanImportedText('Ã¢â‚¬Å“')).toBe('“')
    })
    it('repairs mojibake in the middle of text', () => {
      expect(cleanImportedText('Initiativeâ€™s')).toBe('Initiative’s')
    })
    it('repairs pound sign mojibake', () => {
      expect(cleanImportedText('Â£5')).toBe('£5')
    })

    it('does not change legit UTF-8 text: Turkish', () => {
      expect(cleanImportedText('Ayşe Saygin')).toBe('Ayşe Saygin')
    })
    it('does not change legit UTF-8 text: French', () => {
      expect(cleanImportedText('café')).toBe('café')
    })
    it('does not change legit UTF-8 text: French diaeresis', () => {
      expect(cleanImportedText('naïve')).toBe('naïve')
    })
    it('does not change legit UTF-8 text: German', () => {
      expect(cleanImportedText('Zürich')).toBe('Zürich')
    })
    it('does not change legit UTF-8 text: Portuguese', () => {
      expect(cleanImportedText('São Paulo')).toBe('São Paulo')
    })
    it('does not change legit UTF-8 text: mixed with symbol', () => {
      expect(cleanImportedText('€5 — ok')).toBe('€5 — ok')
    })
    it('does not change legit UTF-8 text: Spanish', () => {
      expect(cleanImportedText('Ñandú')).toBe('Ñandú')
    })
    it('does not change legit UTF-8 text: French grave', () => {
      expect(cleanImportedText('déjà vu')).toBe('déjà vu')
    })
    it('does not change legit UTF-8 text: emoji', () => {
      expect(cleanImportedText('🧠 ok')).toBe('🧠 ok')
    })
    it('does not change legit UTF-8 text: CJK', () => {
      expect(cleanImportedText('脳')).toBe('脳')
    })
  })

  describe('importedDocumentTitle with double-encoded text', () => {
    it('handles double-encoded titles in removal of legacy label', () => {
      expect(importedDocumentTitle('Historical RM Ã¢â‚¬â€ not stated', 'rm')).toBe('not stated')
    })
    it('composes review title from double-encoded RM title', () => {
      const rmTitle = 'Review of Historical RM Ã¢â‚¬â€ not stated'
      expect(importedDocumentTitle('Historical Review Ã¢â‚¬â€ ignore', 'review', rmTitle)).toBe(`Review of ${rmTitle}`)
    })
  })

  describe('fallbacks and draft titles', () => {
    it('keeps en and em dashes distinct', () => {
      expect(cleanImportedText('a â€“ b â€” c')).toBe('a – b — c')
      expect(cleanImportedText('â€˜hiâ€™')).toBe('‘hi’')
    })
    it('repairs triple encoding and leaves clean text alone', () => {
      const once = (s: string) => new TextDecoder('windows-1252').decode(new TextEncoder().encode(s))
      expect(repairMojibake(once(once(once('“Initiative’s start” — ok'))))).toBe('“Initiative’s start” — ok')
      expect(repairMojibake('Ayşe — “café” naïve')).toBe('Ayşe — “café” naïve')
    })
    it('presents database-built review draft titles like the imported RM', () => {
      expect(presentDocumentTitle('Review of Historical RM Ã¢â‚¬â€ not stated')).toBe('Review of not stated')
      expect(presentDocumentTitle('Review of Week 3 plan')).toBe('Review of Week 3 plan')
    })
  })
})
