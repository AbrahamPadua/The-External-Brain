import type { DocumentRecord, Obligation } from './model'
import { losAngelesMonday } from './domain'

export const obligationWeek = (ob: Obligation, demo: boolean) =>
  ob.cycleMonday ?? (demo ? losAngelesMonday(new Date(ob.due)) : undefined)

/** A draft revision retains its published versions; a fresh draft has none. */
export const isPublishedDocument = (doc: DocumentRecord) =>
  doc.status === 'submitted' || doc.versions.length > 0 || !!doc.submittedAt

export function obligationDocument(ob: Obligation, docs: DocumentRecord[], demo: boolean) {
  const week = obligationWeek(ob, demo)
  const matching = docs.filter(d => !d.historical && d.kind === ob.kind &&
    (d.obligationId ? d.obligationId === ob.id : ob.kind === 'rm'
      ? d.initiativeId === ob.initiativeId && !!week && d.targetMonday === week
      : !!ob.targetId && d.targetId === ob.targetId && d.authorId === ob.assigneeId &&
        d.targetVersion === ob.targetVersion))
  return matching.find(d => d.obligationId === ob.id) ?? matching.find(isPublishedDocument) ?? matching[0]
}

export function assignedReviewObligation(obligations: Obligation[], userId: string | null,
  targetId: string | undefined, targetVersion: number | undefined, obligationId?: string, allowCompleted=false) {
  const matches = obligations.filter(o => o.kind === 'review' && o.assigneeId === userId &&
    !!targetId && o.targetId === targetId && o.targetVersion === targetVersion &&
    (obligationId ? o.id === obligationId : true) &&
    (['pending','missed'].includes(o.status) || (allowCompleted && o.status==='complete')))
  if (matches.length !== 1) throw new Error('No unambiguous assigned review for this report and version. Ask Research to check the assignment.')
  return matches[0]
}
