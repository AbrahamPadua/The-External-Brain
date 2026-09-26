// Reverse Windows-1252: the byte each character would have come from when
// UTF-8 bytes were misread as cp1252.
const CP1252_SPECIALS = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ'
const CP1252_BYTE = new Map<string, number>()
for (let i = 0; i < CP1252_SPECIALS.length; i++) CP1252_BYTE.set(CP1252_SPECIALS[i], 0x80 + i)
for (let b = 0xA0; b <= 0xFF; b++) CP1252_BYTE.set(String.fromCharCode(b), b)
const CONTINUATION = CP1252_SPECIALS + String.fromCharCode(...Array.from({ length: 0x20 }, (_, i) => 0xA0 + i))
// One or more UTF-8 lead bytes (C2..F4) each followed by continuation bytes (80..BF).
const MOJIBAKE_RUN = new RegExp(`(?:[\u00C2-\u00F4][${CONTINUATION}]+)+`, 'g')
const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true })

function decodeRun(run: string): string {
  const bytes = Array.from(run, (ch) => CP1252_BYTE.get(ch) ?? -1)
  if (bytes.includes(-1)) return run
  try {
    return STRICT_UTF8.decode(new Uint8Array(bytes))
  } catch {
    // cp1252 has no character for 0x9D, so a misread U+201D (E2 80 9D) often
    // lost its last byte on the way through. Restore it and try once more.
    if (bytes.at(-2) === 0xE2 && bytes.at(-1) === 0x80) {
      try { return STRICT_UTF8.decode(new Uint8Array([...bytes, 0x9D])) } catch { /* not mojibake */ }
    }
    return run
  }
}

/**
 * Undo UTF-8 text that was misdecoded as Windows-1252, once or several times
 * ("â€”" and "Ã¢â‚¬â€" both become "—"). Only runs that decode to valid UTF-8
 * are replaced, so ordinary accented text such as "café" or "Ayşe" is untouched.
 */
export function repairMojibake(value: string): string {
  let text = value
  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(MOJIBAKE_RUN, decodeRun)
    if (next === text) break
    text = next
  }
  return text
}

/** Presentation only: source versions and user-written titles remain stored verbatim. */
export function cleanImportedText(value: string): string {
  // Fallbacks for single-level fragments whose bytes were partly lost.
  return repairMojibake(value)
    .replaceAll('â€”', '—').replaceAll('â€“', '–')
    .replaceAll('â€™', '’').replaceAll('â€˜', '‘')
    .replaceAll('â€œ', '“').replaceAll('â€\u009d', '”').replaceAll('â€', '”').replaceAll('Â ', ' ')
}

/**
 * Title of a non-imported document. Review drafts are titled by the database as
 * "Review of " + the RM's stored title, which for an imported RM still carries
 * the "Historical RM —" prefix and any encoding damage; show it the way the
 * imported RM itself is shown.
 */
export function presentDocumentTitle(value: string): string {
  return cleanImportedText(value).replace(/^Review of Historical\s+(?:RM|review)\s*(?:[—–:-]\s*)?/i, 'Review of ')
}

export function importedDocumentTitle(value: string, kind: string, relatedRmTitle?: string): string {
  if (kind === 'review' && relatedRmTitle) return `Review of ${relatedRmTitle}`
  const title = cleanImportedText(value).replace(/^Historical\s+(?:RM|review)\s*(?:[—–:-]\s*)?/i, '').trim()
  return title || (kind === 'rm' ? 'Roast Me' : 'Peer review')
}
