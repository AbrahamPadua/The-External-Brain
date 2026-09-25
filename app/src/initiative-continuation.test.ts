import { describe, expect, it } from 'vitest'
import { demoAction } from './demo'
import { seed } from './model'

describe('demo initiative continuation', () => {
  it('lets Research edit before assignment and assign an approved nonmember', async () => {
    const data = structuredClone(seed)
    const ini = data.initiatives.find((i) => i.id === 'memory')!
    ini.leadId = ''
    ini.leadName = 'Source Lead'
    ini.members = []
    const details = {
      initiativeId: ini.id, title: 'Continued memory study',
      abstract: 'A sufficiently detailed abstract for the resumed study.',
      category: 'Cognitive science', motivation: '', overviewHtml: '<p>Next phase</p>',
    }
    await expect(demoAction(data, 'sam', 'updateInitiativeDetails', details)).rejects.toThrow()
    const edited = await demoAction(data, 'maya', 'updateInitiativeDetails', details)
    expect(edited.initiatives.find((i) => i.id === ini.id)?.overviewHtml).toBe('')
    await expect(demoAction(edited, 'sam', 'transferLead', { initiativeId: ini.id, userId: 'alex' })).rejects.toThrow()
    const assigned = await demoAction(edited, 'maya', 'transferLead', { initiativeId: ini.id, userId: 'sam' })
    const resumed = assigned.initiatives.find((i) => i.id === ini.id)!
    expect(resumed.leadId).toBe('sam')
    expect(resumed.leadName).toBe('Source Lead')
    expect(resumed.members).toContain('sam')
  })

  it('lets the assigned lead revise a source RM while keeping its original version and attribution', async () => {
    const data = structuredClone(seed)
    const revised = await demoAction(data, 'alex', 'reviseRm', {
      documentId: 'rm-legacy', expectedVersion: 1, title: 'Week 3 update',
      body: '<p>Continued work</p>', reason: 'Added current findings', sourceAuthor: 'A. Historian',
    })
    const doc = revised.documents.find((d) => d.id === 'rm-legacy')!
    expect(doc.versions.map((v) => v.version)).toEqual([1, 2])
    expect(doc.versions[0]).toEqual(data.documents.find((d) => d.id === 'rm-legacy')!.versions[0])
    expect(doc.authorName).toBe('A. Historian')
    await expect(demoAction(data, 'alex', 'reviseRm', {
      documentId: 'rm-legacy', expectedVersion: 1, reason: 'Wrong attribution',
      sourceAuthor: 'Different Person',
    })).rejects.toThrow(/attribution/i)
  })
})
