/**
 * Roast Me drafting and the working week. Run from app/:
 *   npx vitest run src/rm-cycle.test.ts
 *
 * "RM" is a Roast Me: constructive criticism of a team's work, never a
 * reporting memo. The behaviour under test is that drafting one is independent
 * of Research opening a cycle, while submitting still requires that week's cycle
 * to be open and still belongs to the lead.
 *
 * The demo engine is the executable mirror of migration 013's save_rm_draft /
 * set_rm_draft_target / submit_rm_draft; the PGlite script
 * scripts/check-rm-cycle.mjs covers the SQL side.
 */
import { describe, expect, it } from 'vitest'
import { demoAction } from './demo'
import { addWeeksIso, isMondayIso, losAngelesMonday } from './domain'
import { seed } from './model'
import type { Data, DocumentRecord } from './model'

const fresh = (): Data => structuredClone(seed)
const rmDrafts = (d: Data, initiativeId: string): DocumentRecord[] =>
  d.documents.filter((x) => x.kind === 'rm' && x.status === 'draft' && x.initiativeId === initiativeId)

const LEAD = 'maya'      // approved, leads "sound"
const TEAMMATE = 'alex'  // approved, member of "sound", leads "memory"
const OUTSIDER = 'sam'   // approved, operations, on neither team
const PENDING = 'jordan' // not approved

describe('Los Angeles working week', () => {
  it('names the Monday of the week containing a reference date', () => {
    // 2026-09-09 is a Wednesday; its LA week starts Monday 2026-09-07.
    expect(losAngelesMonday(new Date('2026-09-09T19:00:00Z'))).toBe('2026-09-07')
    expect(losAngelesMonday(new Date('2026-09-07T08:00:00Z'))).toBe('2026-09-07')
    // 07:00Z on Monday is still Sunday evening in Los Angeles.
    expect(losAngelesMonday(new Date('2026-09-07T06:00:00Z'))).toBe('2026-08-31')
  })

  it('always defaults to a Monday', () => {
    expect(isMondayIso(losAngelesMonday())).toBe(true)
  })

  it('recognises and shifts Mondays only', () => {
    expect(isMondayIso('2026-09-07')).toBe(true)
    expect(isMondayIso('2026-09-08')).toBe(false)
    expect(isMondayIso('2026-9-7')).toBe(false)
    expect(addWeeksIso('2026-09-07', 1)).toBe('2026-09-14')
    expect(addWeeksIso('2026-09-07', -1)).toBe('2026-08-31')
  })
})

describe('drafting a Roast Me without an open cycle', () => {
  it('is the root failure: the team can draft when no cycle exists for the week', async () => {
    const data = fresh()
    data.cycles = []                       // nothing opened at all
    const after = await demoAction(data, LEAD, 'createDraft', { initiativeId: 'sound', kind: 'rm' })
    const drafts = rmDrafts(after, 'sound')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].targetMonday).toBe(losAngelesMonday())   // current LA week by default
    expect(after.obligations).toHaveLength(seed.obligations.length) // no obligation invented
  })

  it('accepts an explicitly selected week and reuses that week\'s draft', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    let data = await demoAction(fresh(), LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: week })
    expect(rmDrafts(data, 'sound')[0].targetMonday).toBe(week)
    data = await demoAction(data, LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: week })
    expect(rmDrafts(data, 'sound')).toHaveLength(1)          // reused, not duplicated
    // A different week is a different draft.
    data = await demoAction(data, LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: addWeeksIso(week, 1) })
    expect(rmDrafts(data, 'sound')).toHaveLength(2)
  })

  it('refuses a week that is not a Monday', async () => {
    await expect(demoAction(fresh(), LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: '2026-09-08' })).rejects.toThrow(/Monday/i)
  })

  it('lets a teammate who is not the lead draft', async () => {
    const data = await demoAction(fresh(), TEAMMATE, 'createDraft', { initiativeId: 'sound', kind: 'rm' })
    expect(rmDrafts(data, 'sound')).toHaveLength(1)
  })

  it('does not open drafting to outsiders or unapproved accounts', async () => {
    await expect(demoAction(fresh(), OUTSIDER, 'createDraft', { initiativeId: 'sound', kind: 'rm' }))
      .rejects.toThrow(/team/i)
    await expect(demoAction(fresh(), PENDING, 'createDraft', { initiativeId: 'sound', kind: 'rm' }))
      .rejects.toThrow(/approved/i)
  })
})

describe('changing a draft target before submission', () => {
  const startDraft = async (actor = LEAD) => {
    const data = await demoAction(fresh(), actor, 'createDraft', { initiativeId: 'sound', kind: 'rm' })
    return { data, draft: rmDrafts(data, 'sound')[0] }
  }

  it('moves the draft to another week', async () => {
    const { data, draft } = await startDraft()
    const week = addWeeksIso(losAngelesMonday(), 2)
    const after = await demoAction(data, TEAMMATE, 'setDraftTarget',
      { documentId: draft.id, targetMonday: week })
    expect(rmDrafts(after, 'sound')[0].targetMonday).toBe(week)
  })

  it('does not retarget onto another Roast Me for the same week', async () => {
    const firstWeek = addWeeksIso(losAngelesMonday(), 1)
    const secondWeek = addWeeksIso(firstWeek, 1)
    let data = await demoAction(fresh(), LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: firstWeek })
    data = await demoAction(data, TEAMMATE, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: secondWeek })
    const second = rmDrafts(data, 'sound').find((d) => d.targetMonday === secondWeek)!
    await expect(demoAction(data, LEAD, 'setDraftTarget', {
      documentId: second.id, targetMonday: firstWeek,
    })).rejects.toThrow(/already exists/i)
  })

  it('rejects a non-Monday, an outsider and a submitted document', async () => {
    const { data, draft } = await startDraft()
    await expect(demoAction(data, LEAD, 'setDraftTarget',
      { documentId: draft.id, targetMonday: '2026-09-10' })).rejects.toThrow(/Monday/i)
    await expect(demoAction(data, OUTSIDER, 'setDraftTarget',
      { documentId: draft.id, targetMonday: losAngelesMonday() })).rejects.toThrow(/team/i)
    await expect(demoAction(data, LEAD, 'setDraftTarget',
      { documentId: 'rm-sound', targetMonday: losAngelesMonday() })).rejects.toThrow()
  })
})

describe('submitting still needs that week\'s cycle', () => {
  const draftFor = async (week: string) => {
    const data = await demoAction(fresh(), LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: week })
    return { data, draft: rmDrafts(data, 'sound')[0] }
  }

  it('explains a pending week instead of failing obscurely', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    const { data, draft } = await draftFor(week)
    await expect(demoAction(data, LEAD, 'submitDocument', { documentId: draft.id, body: '<p>x</p>' }))
      .rejects.toThrow(/not open yet/i)
  })

  it('goes through once Research opens that week', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    const started = await draftFor(week)
    const opened = await demoAction(started.data, LEAD, 'openCycle', { monday: week, isBreak: false })
    expect((opened.cycles ?? []).some((c) => c.startsOn === week)).toBe(true)
    const submitted = await demoAction(opened, LEAD, 'submitDocument',
      { documentId: started.draft.id, body: '<p>Please roast this.</p>' })
    const doc = submitted.documents.find((x) => x.id === started.draft.id)!
    const selectedWeekObligation = submitted.obligations.find((o) =>
      o.kind === 'rm' && o.initiativeId === 'sound' && losAngelesMonday(new Date(o.due)) === week)!
    expect(doc.status).toBe('submitted')
    expect(doc.targetMonday).toBe(week)
    expect(doc.obligationId).toBe(selectedWeekObligation.id)
    expect(selectedWeekObligation.status).toBe('complete')
    expect(submitted.obligations.find((o) => o.id === 'o1')!.status).toBe('pending')
  })

  it('chooses the cycle at submission and completes only that week', async () => {
    const initialWeek = losAngelesMonday()
    const selectedWeek = addWeeksIso(initialWeek, 1)
    let data = await demoAction(fresh(), LEAD, 'createDraft',
      { initiativeId: 'sound', kind: 'rm' })
    const draft = rmDrafts(data, 'sound')[0]
    expect(draft.targetMonday).toBe(initialWeek)

    data = await demoAction(data, LEAD, 'openCycle', { monday: initialWeek, isBreak: false })
    data = await demoAction(data, LEAD, 'openCycle', { monday: selectedWeek, isBreak: false })
    data = await demoAction(data, LEAD, 'setDraftTarget',
      { documentId: draft.id, targetMonday: selectedWeek })
    data = await demoAction(data, LEAD, 'submitDocument',
      { documentId: draft.id, body: '<p>Choose on submit.</p>' })

    const submitted = data.documents.find((doc) => doc.id === draft.id)!
    const selected = data.obligations.find((o) => o.id === submitted.obligationId)!
    const initial = data.obligations.find((o) =>
      o.kind === 'rm' && o.initiativeId === 'sound'
      && losAngelesMonday(new Date(o.due)) === initialWeek)!
    expect(submitted.targetMonday).toBe(selectedWeek)
    expect(losAngelesMonday(new Date(selected.due))).toBe(selectedWeek)
    expect(selected.status).toBe('complete')
    expect(initial.status).toBe('pending')
  })

  it('keeps the week fixed after a submitted Roast Me is reopened for revision', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    const started = await draftFor(week)
    let data = await demoAction(started.data, LEAD, 'openCycle', { monday: week, isBreak: false })
    data = await demoAction(data, LEAD, 'submitDocument', { documentId: started.draft.id })
    data = await demoAction(data, LEAD, 'reviseDocument', { documentId: started.draft.id })
    await expect(demoAction(data, LEAD, 'setDraftTarget', {
      documentId: started.draft.id, targetMonday: addWeeksIso(week, 1),
    })).rejects.toThrow(/attached/i)
  })

  it('refuses a break week', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    const started = await draftFor(week)
    const opened = await demoAction(started.data, LEAD, 'openCycle', { monday: week, isBreak: true })
    await expect(demoAction(opened, LEAD, 'submitDocument',
      { documentId: started.draft.id, body: '<p>x</p>' })).rejects.toThrow(/break week/i)
  })

  it('keeps submission with the lead, not every teammate', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    const started = await draftFor(week)
    const opened = await demoAction(started.data, LEAD, 'openCycle', { monday: week, isBreak: false })
    await expect(demoAction(opened, TEAMMATE, 'submitDocument',
      { documentId: started.draft.id, body: '<p>x</p>' })).rejects.toThrow(/lead/i)
  })

  it('does not let a second Roast Me start for a week already submitted for', async () => {
    const week = addWeeksIso(losAngelesMonday(), 1)
    const started = await draftFor(week)
    let data = await demoAction(started.data, LEAD, 'openCycle', { monday: week, isBreak: false })
    data = await demoAction(data, LEAD, 'submitDocument',
      { documentId: started.draft.id, body: '<p>first</p>' })
    await expect(demoAction(data, TEAMMATE, 'createDraft',
      { initiativeId: 'sound', kind: 'rm', targetMonday: week })).rejects.toThrow(/already exists/i)
  })
})

describe('opening a cycle', () => {
  it('records the week and creates one RM obligation per active initiative', async () => {
    const week = addWeeksIso(losAngelesMonday(), 3)
    const once = await demoAction(fresh(), LEAD, 'openCycle', { monday: week, isBreak: false })
    const rmFor = (d: Data) => d.obligations.filter((o) => o.kind === 'rm' && o.id.includes(week))
    expect(rmFor(once)).toHaveLength(2)                       // "sound" and "memory"
    const twice = await demoAction(once, LEAD, 'openCycle', { monday: week, isBreak: false })
    expect(rmFor(twice)).toHaveLength(2)                      // idempotent, no duplicate
    expect((twice.cycles ?? []).filter((c) => c.startsOn === week)).toHaveLength(1)
  })

  it('is Research only and Monday only', async () => {
    await expect(demoAction(fresh(), TEAMMATE, 'openCycle',
      { monday: losAngelesMonday(), isBreak: false })).rejects.toThrow(/Research/i)
    await expect(demoAction(fresh(), LEAD, 'openCycle',
      { monday: '2026-09-09', isBreak: false })).rejects.toThrow(/Monday/i)
  })
})

describe('imported historical Roast Mes stay untouched', () => {
  it('cannot be retargeted', async () => {
    await expect(demoAction(fresh(), LEAD, 'setDraftTarget',
      { documentId: 'rm-legacy', targetMonday: losAngelesMonday() })).rejects.toThrow()
    expect(fresh().documents.find((d) => d.id === 'rm-legacy')!.versions).toHaveLength(1)
  })
})
