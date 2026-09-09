import { describe, expect, it } from 'vitest'
import {
  appendLedgerEvent, canApproveAccount, canViewInternalAccount,
  getReviewCycleBoundaries, reconcileReviewOutcome, replayHp, reverseLedgerEvent,
  type Account, type LedgerEvent,
} from './domain'

describe('review-cycle boundaries', () => {
  it('uses Friday and Sunday 23:59 Los Angeles across US DST', () => {
    const cycle = getReviewCycleBoundaries(new Date('2026-03-09T12:00:00Z'))
    expect(cycle.cycleId).toBe('2026-03-09')
    expect(cycle.losAngelesDeadline.toISOString()).toBe('2026-03-14T06:59:00.000Z')
    expect(cycle.reviewDeadline.toISOString()).toBe('2026-03-16T06:59:00.000Z')
  })

  it('uses Pacific time for both deadlines', () => {
    const cycle = getReviewCycleBoundaries(new Date('2026-03-30T12:00:00Z'))
    expect(cycle.losAngelesDeadline.toISOString()).toBe('2026-04-04T06:59:00.000Z')
    expect(cycle.reviewDeadline.toISOString()).toBe('2026-04-06T06:59:00.000Z')
  })
})

describe('HP ledger', () => {
  const event = (id: string, delta: number): LedgerEvent => ({
    id, delta, at: '2026-09-01T00:00:00.000Z', reason: id,
  })

  it('starts at 100 and applies a floor and cap after every event', () => {
    expect(replayHp([event('loss', -150), event('gain', 140)]).applied.map(({ hpAfter }) => hpAfter))
      .toEqual([0, 100])
  })

  it('appends idempotently and rejects malformed reversals', () => {
    const once = appendLedgerEvent([], event('a', -10))
    expect(appendLedgerEvent(once, event('a', -10))).toHaveLength(1)
    expect(() => appendLedgerEvent(once, { ...event('bad', 10), reversalOf: 'missing' })).toThrow()
  })

  it('reverses an original contribution and replay reflects both events', () => {
    const reversed = reverseLedgerEvent([event('penalty', -12)], 'penalty', new Date('2026-09-02T00:00:00Z'))
    expect(reversed[1]).toMatchObject({ delta: 12, reversalOf: 'penalty' })
    expect(replayHp(reversed).hp).toBe(100)
    expect(reverseLedgerEvent(reversed, 'penalty', new Date())).toHaveLength(2)
  })

  it('makes missed and completion processing idempotent and reverses a late penalty', () => {
    const outcome = { memberId: 'm1', cycleId: '2026-09-07' }
    const missed = reconcileReviewOutcome([], outcome, new Date('2026-09-14T00:00:00Z'))
    expect(reconcileReviewOutcome(missed, outcome)).toHaveLength(1)
    const late = reconcileReviewOutcome(missed, { ...outcome, completedAt: new Date('2026-09-14T01:00:00Z') })
    expect(late.map(({ delta }) => delta)).toEqual([-10, 10, 4])
    expect(reconcileReviewOutcome(late, { ...outcome, completedAt: new Date() })).toHaveLength(3)
    expect(replayHp(late).hp).toBe(100)
  })
})

describe('account permissions', () => {
  const account = (id: string, status: Account['status'], role: Account['role'] = 'member'): Account =>
    ({ id, status, role })

  it('limits internal visibility to approved accounts, except a pending account can see itself', () => {
    expect(canViewInternalAccount(account('approved', 'approved'), account('other', 'pending'))).toBe(true)
    expect(canViewInternalAccount(account('pending', 'pending'), account('pending', 'pending'))).toBe(true)
    expect(canViewInternalAccount(account('pending', 'pending'), account('other', 'approved'))).toBe(false)
    expect(canViewInternalAccount(account('rejected', 'rejected'), account('rejected', 'rejected'))).toBe(false)
  })

  it.each(['research-admin', 'operations-admin'] as const)('%s can approve another pending account', (role) => {
    expect(canApproveAccount(account('admin', 'approved', role), account('candidate', 'pending'))).toBe(true)
  })

  it('blocks ordinary, unapproved, self, and already-decided approvals', () => {
    expect(canApproveAccount(account('member', 'approved'), account('candidate', 'pending'))).toBe(false)
    expect(canApproveAccount(account('admin', 'pending', 'research-admin'), account('candidate', 'pending'))).toBe(false)
    expect(canApproveAccount(account('same', 'approved', 'research-admin'), account('same', 'pending'))).toBe(false)
    expect(canApproveAccount(account('admin', 'approved', 'research-admin'), account('candidate', 'approved'))).toBe(false)
  })
})
