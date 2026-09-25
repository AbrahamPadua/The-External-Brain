import type { DocumentRecord } from './model'
import { losAngelesMonday } from './domain'

export type ProgressSort = 'newest' | 'oldest' | 'reviewed' | 'awaiting'
export type ProgressEntry = { rm: DocumentRecord; reviews: DocumentRecord[] }
export type ProgressGroup = { key: string; label: string; monday?: string; order: number; entries: ProgressEntry[] }

export function progressPeriod(doc: DocumentRecord): Omit<ProgressGroup, 'entries'> {
  const date = doc.targetMonday || (/^\d{4}-\d{2}-\d{2}$/.test(doc.sourceDate ?? '') ? doc.sourceDate : undefined)
    || (!doc.historical && doc.submittedAt ? doc.submittedAt.slice(0, 10) : undefined)
  if (date && !Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    const monday = losAngelesMonday(new Date(`${date}T12:00:00Z`))
    return { key: monday, monday, label: `Week of ${new Date(`${monday}T12:00:00Z`).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}`, order: Date.parse(monday) }
  }
  const label = [doc.sourcePeriod, doc.sourceWeek].filter(Boolean).join(' · ') || 'Date unavailable'
  return {key: `source:${doc.sourcePeriodKey || doc.sourcePeriod || ''}:${doc.sourceWeek || ''}`, label, order: doc.sourceOrder ?? -1}
}

export function groupProgress(initiativeId: string, documents: DocumentRecord[], sort: ProgressSort = 'newest') {
  const rms = documents.filter(d => d.initiativeId === initiativeId && d.kind === 'rm')
  const ids = new Set(rms.map(d => d.id))
  const groups = new Map<string, ProgressGroup>()
  for (const rm of rms) {
    const reviews = documents.filter(d => d.kind === 'review' && d.targetId === rm.id)
      .sort((a,b) => (b.submittedAt || b.sourceDate || '').localeCompare(a.submittedAt || a.sourceDate || '') || a.title.localeCompare(b.title))
    if (sort === 'awaiting' && (reviews.some(r => r.status !== 'draft') || rm.status === 'draft')) continue
    const period = progressPeriod(rm)
    const group = groups.get(period.key) ?? {...period, entries: []}
    group.order = Math.max(group.order, period.order)
    group.entries.push({rm, reviews})
    groups.set(period.key, group)
  }
  const reviewCount = (group: ProgressGroup) => group.entries.reduce((n,e) => n + e.reviews.filter(r => r.status !== 'draft').length, 0)
  const result = [...groups.values()].sort((a,b) =>
    (sort === 'reviewed' ? reviewCount(b) - reviewCount(a) : 0)
    || (a.monday && !b.monday ? -1 : !a.monday && b.monday ? 1 : 0)
    || (sort === 'oldest' ? a.order - b.order : b.order - a.order) || a.label.localeCompare(b.label))
  for (const group of result) group.entries.sort((a,b) =>
    (sort === 'reviewed' ? b.reviews.length - a.reviews.length : 0) || a.rm.title.localeCompare(b.rm.title))
  // Reviews authored for other initiatives or whose source target is unavailable
  // remain discoverable instead of being attached to an unrelated RM.
  const otherReviews = documents.filter(d => d.initiativeId === initiativeId && d.kind === 'review' && !ids.has(d.targetId ?? ''))
  return { groups: result, otherReviews, totalRms: rms.length,
    totalReviews: documents.filter(d => d.kind === 'review' && ids.has(d.targetId ?? '')).length }
}
