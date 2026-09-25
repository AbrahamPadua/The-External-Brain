import { useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { CalendarDays, ChevronDown, FileText, Flame, MessageSquare } from 'lucide-react'
import type { DocumentRecord, Person } from './model'
import { textOfHtml } from './highlight'
import { groupProgress } from './progress-data'
import type { ProgressSort } from './progress-data'

export function Progress({ initiativeId, documents, people, currentCycle, startRm, onOpen, onRoast, roastReason, busy }: {
  initiativeId: string; documents: DocumentRecord[]; people: Person[]; currentCycle?: string;
  startRm: ReactNode; onOpen: (id: string) => void; onRoast: (rm: DocumentRecord) => void;
  roastReason: (rm: DocumentRecord) => string; busy: boolean;
}) {
  const [sort, setSort] = useState<ProgressSort>('newest')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const {groups, otherReviews, totalRms, totalReviews} = groupProgress(initiativeId, documents, sort)
  const openLink = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); onOpen(id) }
  }
  const reviewCard = (review: DocumentRecord) => {
    const author = review.authorName || people.find(p => p.id === review.authorId)?.name || 'Author unavailable'
    return <article key={review.id} className="progress-review">
      <div className="progress-review-heading"><div><strong>{author}</strong><span className="progress-status">{review.status}</span></div>
        <a href={`#/document/${review.id}`} onClick={e => openLink(e, review.id)}>View full review →</a></div>
      <p>{review.title}</p>
      <p className="progress-review-excerpt">{textOfHtml(review.body).replace(/\s+/g, ' ').trim().slice(0, 240)}{textOfHtml(review.body).length > 240 ? '...' : ''}</p>
      <span className="field-hint">{review.sourceDate || review.sourcePeriod || (review.submittedAt ? new Date(review.submittedAt).toLocaleDateString() : 'Not submitted')}</span>
    </article>
  }
  return <div className="progress-workspace">
    <div className="progress-toolbar"><div className="row"><h2>Progress</h2><span className="progress-caption">RMs and peer reviews</span></div>
      <div className="row"><select aria-label="Sort progress" value={sort} onChange={e => setSort(e.target.value as ProgressSort)}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
        <option value="reviewed">Most reviewed</option><option value="awaiting">Awaiting review</option>
      </select>{startRm}</div></div>
    <div className="progress-columns" aria-hidden="true"><span>Roast Me</span><span>Status</span><span>Reviews / Actions</span></div>
    <div className="progress-feed">
      {groups.map(group => <section key={group.key} className="progress-cycle" aria-label={group.label}>
        <header className="progress-cycle-heading"><div className="row"><CalendarDays size={19} /><h3>{group.label}</h3>
          {group.monday === currentCycle ? <span className="progress-current">Current cycle</span> : null}</div>
          <span className="progress-counts">{group.entries.length} {group.entries.length === 1 ? 'RM' : 'RMs'} · {group.entries.reduce((n,e) => n + e.reviews.length, 0)} reviews</span></header>
        {group.entries.map(({rm,reviews}) => {
          const reason = roastReason(rm)
          const isOpen = expanded.has(rm.id)
          return <article key={rm.id} className="progress-rm">
            <div className="progress-rm-row">
              <div className="progress-title"><FileText size={20} aria-hidden="true" /><div>
                <a href={`#/document/${rm.id}`} onClick={e => openLink(e,rm.id)}>{rm.title}</a>
                <p className="field-hint">{rm.authorName || people.find(p => p.id === rm.authorId)?.name || 'Author unavailable'}{rm.sourceWeek ? ` · ${rm.sourceWeek}` : ''}</p>
              </div></div>
              <span className={`progress-status progress-status-${rm.status}`}>{rm.status}</span>
              <div className="progress-rm-actions"><button type="button" className="btn sm progress-roast" disabled={busy || !!reason}
                title={reason || 'Write a review for this RM'} onClick={() => onRoast(rm)}><Flame size={16} /> Roast</button>
                {reviews.length ? <button type="button" className="btn ghost sm" aria-expanded={isOpen} aria-controls={`reviews-${rm.id}`}
                  onClick={() => setExpanded(old => {const next = new Set(old); if (next.has(rm.id)) next.delete(rm.id); else next.add(rm.id); return next})}>
                  <MessageSquare size={15} /> Reviews ({reviews.length})<ChevronDown size={16} className={isOpen ? 'progress-chevron-open' : ''} />
                </button> : <span className="progress-no-reviews">No reviews yet</span>}
              </div>
            </div>
            {reviews.length && isOpen ? <div id={`reviews-${rm.id}`} className="progress-reviews">{reviews.map(reviewCard)}</div> : null}
          </article>
        })}
      </section>)}
      {!groups.length ? <p className="muted">{sort === 'awaiting' ? 'No submitted RMs are awaiting review.' : 'No Roast Mes yet.'}</p> : null}
    </div>
    {otherReviews.length ? <section className="progress-other-reviews"><h3>Other reviews</h3><p className="muted">Reviews for other initiatives or without an available RM.</p>{otherReviews.map(reviewCard)}</section> : null}
    <footer className="progress-footer">{totalRms} Roast Mes · {totalReviews} linked peer reviews</footer>
  </div>
}
