import type { Initiative, Person } from './model'
import { cleanImportedText } from './imported-title'

export const ABSTRACT_MAX = 100000

export function canEditInitiative(initiative: Initiative, person?: Person): boolean {
  return !!person && person.status === 'approved' && (
    initiative.members.includes(person.id) || initiative.leadId === person.id || person.roles.includes('research')
  )
}

/** Compatibility while migration 020 promotes existing overview text to summary. */
export function initiativeAbstract(summary: string, overviewHtml?: string): string {
  if (!overviewHtml?.trim()) return cleanImportedText(summary)
  const doc = new DOMParser().parseFromString(overviewHtml, 'text/html')
  doc.querySelectorAll('script,style').forEach(node => node.remove())
  doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'))
  doc.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,tr').forEach(node => node.append('\n\n'))
  const text = (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return cleanImportedText(text || summary)
}

export function textToHtml(text: string): string {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return '<p>' + escaped.replace(/\r\n?/g, '\n').replace(/\n\n+/g, '</p><p>').replaceAll('\n', '<br>') + '</p>'
}
