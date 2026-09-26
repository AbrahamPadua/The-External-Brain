import { describe, expect, it } from 'vitest'
import { navigationAccess } from './App'

describe('navigation access', () => {
  it('keeps organizational pages from ordinary members', () => {
    expect(navigationAccess({ approved: true, isResearch: false, isOperations: false, isInitiativeLead: false }))
      .toEqual({ accounts: false, audit: false, health: false })
  })

  it('does not give initiative leads organizational pages, including Health', () => {
    expect(navigationAccess({ approved: true, isResearch: false, isOperations: false, isInitiativeLead: true }))
      .toEqual({ accounts: false, audit: false, health: false })
  })

  it.each([
    { isResearch: true, isOperations: false },
    { isResearch: false, isOperations: true },
    { isResearch: true, isOperations: true },
  ])('allows organizational roles: %o', ({ isResearch, isOperations }) => {
    expect(navigationAccess({ approved: true, isResearch, isOperations, isInitiativeLead: false }))
      .toEqual({ accounts: true, audit: true, health: true })
  })

  it('denies unapproved accounts even if stale flags are present', () => {
    expect(navigationAccess({ approved: false, isResearch: true, isOperations: true, isInitiativeLead: true }))
      .toEqual({ accounts: false, audit: false, health: false })
  })
})
