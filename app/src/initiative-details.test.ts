// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { canEditInitiative, initiativeAbstract } from './initiative-details'
import { seed } from './model'

describe('initiative abstract and edit permissions', () => {
  it('promotes the overview, cleans punctuation, and retains line breaks', () => {
    expect(initiativeAbstract('Old abstract', '<p>â€œAURORAâ€ &amp; Iâ€™m ready.</p><p>Second<br>Third</p>'))
      .toBe('“AURORA” & I’m ready.\n\nSecond\nThird')
    expect(initiativeAbstract('First\n\nSecond')).toBe('First\n\nSecond')
    expect(initiativeAbstract('Fallback', '<p></p>')).toBe('Fallback')
  })
  it('allows approved members and explicit Research, but not unrelated administrators', () => {
    const ini = {...seed.initiatives[0], leadId: 'lead', members: ['member']}
    const person = {...seed.people[0], id: 'member', status: 'approved' as const, roles: []}
    expect(canEditInitiative(ini, person)).toBe(true)
    expect(canEditInitiative(ini, {...person, id: 'lead'})).toBe(true)
    expect(canEditInitiative(ini, {...person, id: 'other', roles: ['research']})).toBe(true)
    expect(canEditInitiative(ini, {...person, id: 'other', roles: ['admin']})).toBe(false)
    expect(canEditInitiative(ini, {...person, id: 'other'})).toBe(false)
    expect(canEditInitiative(ini, {...person, status: 'pending'})).toBe(false)
    expect(canEditInitiative(ini)).toBe(false)
  })
})
