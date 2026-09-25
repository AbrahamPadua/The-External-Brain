/** Presentation only: source versions and user-written titles remain stored verbatim. */
export function cleanImportedText(value: string): string {
  return value.replaceAll('â€”', '—').replaceAll('â€“', '–')
    .replaceAll('â€™', '’').replaceAll('â€˜', '‘')
    .replaceAll('â€œ', '“').replaceAll('â€\u009d', '”').replaceAll('â€', '”').replaceAll('Â ', ' ')
}

export function importedDocumentTitle(value: string, kind: string, relatedRmTitle?: string): string {
  if (kind === 'review' && relatedRmTitle) return `Review of ${relatedRmTitle}`
  const title = cleanImportedText(value).replace(/^Historical\s+(?:RM|review)\s*(?:[—–:-]\s*)?/i, '').trim()
  return title || (kind === 'rm' ? 'Roast Me' : 'Peer review')
}
