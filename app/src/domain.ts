export const HP_START = 100
export const HP_MIN = 0
export const HP_MAX = 100
export const REVIEW_COMPLETION_HP = 4
export const MISSED_REVIEW_HP = -10

export type AccountRole = 'member' | 'research-admin' | 'operations-admin' | 'admin'
export type AccountStatus = 'pending' | 'approved' | 'rejected' | 'suspended'

export interface Account {
  id: string
  role: AccountRole
  status: AccountStatus
}

export interface LedgerEvent {
  id: string
  at: string
  delta: number
  reason: string
  reversalOf?: string
}

export interface HpReplay {
  hp: number
  applied: ReadonlyArray<LedgerEvent & { hpAfter: number }>
}

export interface ReviewCycleBoundaries {
  cycleId: string
  losAngelesDeadline: Date
  reviewDeadline: Date
}

export interface ReviewOutcome {
  memberId: string
  cycleId: string
  completedAt?: Date
}

const LA = 'America/Los_Angeles'

interface DateParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function partsIn(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: value('year'), month: value('month'), day: value('day'),
    hour: value('hour'), minute: value('minute'), second: value('second'),
  }
}

function zonedDateTime(parts: DateParts, timeZone: string): Date {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  // Search minute-by-minute around the UTC-shaped value. Review deadlines are
  // ordinary wall-clock times, so this also avoids DST offset assumptions.
  for (let offsetMinutes = -18 * 60; offsetMinutes <= 18 * 60; offsetMinutes += 1) {
    const candidate = new Date(target + offsetMinutes * 60_000)
    const actual = partsIn(candidate, timeZone)
    if (actual.year === parts.year && actual.month === parts.month && actual.day === parts.day &&
        actual.hour === parts.hour && actual.minute === parts.minute && actual.second === parts.second) {
      return candidate
    }
  }
  throw new RangeError(`The local time does not exist in ${timeZone}`)
}

function addUtcDays(parts: Pick<DateParts, 'year' | 'month' | 'day'>, days: number): DateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: 23, minute: 59, second: 0,
  }
}

/** Returns the Friday/Sunday deadlines for the LA-local week containing `reference`. */
export function getReviewCycleBoundaries(reference: Date): ReviewCycleBoundaries {
  if (Number.isNaN(reference.getTime())) throw new RangeError('reference must be a valid date')
  const local = partsIn(reference, LA)
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const daysSinceMonday = (localDate.getUTCDay() + 6) % 7
  const monday = addUtcDays(local, -daysSinceMonday)
  const friday = addUtcDays(monday, 4)
  const sunday = addUtcDays(monday, 6)
  const cycleId = `${monday.year}-${String(monday.month).padStart(2, '0')}-${String(monday.day).padStart(2, '0')}`
  return {
    cycleId,
    losAngelesDeadline: zonedDateTime(friday, LA),
    reviewDeadline: zonedDateTime(sunday, LA),
  }
}

export function formatLosAngelesLocal(date: Date): string {
  if (Number.isNaN(date.getTime())) return ''
  const p = partsIn(date, LA)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function parseLosAngelesLocal(localString: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localString)
  if (!match) throw new Error('Invalid local datetime string')
  return zonedDateTime({
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: 0,
  }, LA)
}

export function appendLedgerEvent(ledger: ReadonlyArray<LedgerEvent>, event: LedgerEvent): LedgerEvent[] {
  if (ledger.some(({ id }) => id === event.id)) return [...ledger]
  if (!Number.isFinite(event.delta)) throw new RangeError('event delta must be finite')
  if (Number.isNaN(new Date(event.at).getTime())) throw new RangeError('event timestamp must be valid')
  if (event.reversalOf !== undefined) {
    const original = ledger.find(({ id }) => id === event.reversalOf)
    if (!original) throw new Error(`Cannot reverse missing event ${event.reversalOf}`)
    if (original.reversalOf) throw new Error('A reversal cannot itself be reversed')
    if (ledger.some(({ reversalOf }) => reversalOf === original.id)) return [...ledger]
    if (event.delta !== -original.delta) throw new Error('A reversal must cancel the original delta')
  }
  return [...ledger, { ...event }]
}

export function reverseLedgerEvent(
  ledger: ReadonlyArray<LedgerEvent>,
  originalId: string,
  at: Date,
  reason = 'reversal',
): LedgerEvent[] {
  const original = ledger.find(({ id }) => id === originalId)
  if (!original) throw new Error(`Cannot reverse missing event ${originalId}`)
  return appendLedgerEvent(ledger, {
    id: `reversal:${originalId}`,
    at: at.toISOString(),
    delta: -original.delta,
    reason,
    reversalOf: originalId,
  })
}

export function replayHp(ledger: ReadonlyArray<LedgerEvent>, startingHp = HP_START): HpReplay {
  let hp = Math.min(HP_MAX, Math.max(HP_MIN, startingHp))
  const reversed = new Set(ledger.filter(e => e.reversalOf).map(e => e.reversalOf))
  const applied = ledger.map((event) => {
    if (!event.reversalOf && !reversed.has(event.id)) hp = Math.min(HP_MAX, Math.max(HP_MIN, hp + event.delta))
    return { ...event, hpAfter: hp }
  })
  return { hp, applied }
}

/** Adds one completion, or one missed penalty; a late completion reverses the penalty. */
export function reconcileReviewOutcome(
  ledger: ReadonlyArray<LedgerEvent>,
  outcome: ReviewOutcome,
  recordedAt = new Date(),
): LedgerEvent[] {
  const key = `${outcome.memberId}:${outcome.cycleId}`
  const completionId = `review-completed:${key}`
  const missedId = `review-missed:${key}`
  let next = [...ledger]
  if (next.some(({ id }) => id === completionId)) return next
  if (outcome.completedAt) {
    if (next.some(({ id }) => id === missedId)) {
      next = reverseLedgerEvent(next, missedId, recordedAt, 'late review completed')
    }
    return appendLedgerEvent(next, {
      id: completionId,
      at: outcome.completedAt.toISOString(),
      delta: REVIEW_COMPLETION_HP,
      reason: 'weekly review completed',
    })
  }
  return appendLedgerEvent(next, {
    id: missedId,
    at: recordedAt.toISOString(),
    delta: MISSED_REVIEW_HP,
    reason: 'weekly review missed',
  })
}

export function canViewInternalAccount(viewer: Account, target: Account): boolean {
  return viewer.status === 'approved' || (viewer.id === target.id && viewer.status === 'pending')
}

export function canApproveAccount(actor: Account, target: Account): boolean {
  const isAdmin = actor.role === 'research-admin' || actor.role === 'operations-admin' || actor.role === 'admin'
  return actor.status === 'approved' && isAdmin && actor.id !== target.id && target.status === 'pending'
}
