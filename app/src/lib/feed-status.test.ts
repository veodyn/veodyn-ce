import { describe, expect, it } from 'vitest'
import { cadenceLabel, cadenceToMs, deriveFeedStatus, feedStatusBasis } from './feed-status'
import type { Feed } from '@/types/feed'

const NOW = Date.parse('2026-07-23T12:00:00Z')

function feed(over: Partial<Feed> = {}): Feed {
  return {
    id: 'f',
    name: 'Feed',
    source: 'Src',
    cadence: 'hourly',
    lastReceivedAt: '2026-07-23T11:30:00Z',
    status: 'fresh',
    datasetCount: 1,
    ...over,
  }
}

describe('cadenceToMs', () => {
  it('parses named cadences', () => {
    expect(cadenceToMs('hourly')).toBe(3_600_000)
    expect(cadenceToMs('Daily')).toBe(86_400_000)
  })

  it('parses "every N unit" cadences', () => {
    expect(cadenceToMs('every 2 min')).toBe(120_000)
    expect(cadenceToMs('every 5 minutes')).toBe(300_000)
    expect(cadenceToMs('every 6 hours')).toBe(21_600_000)
  })

  it('returns null for anything it cannot read', () => {
    expect(cadenceToMs('when it feels like it')).toBeNull()
  })
})

describe('deriveFeedStatus', () => {
  it('is fresh within two cadence periods', () => {
    expect(deriveFeedStatus(feed({ lastReceivedAt: '2026-07-23T10:30:00Z' }), NOW)).toBe('fresh')
  })

  it('is stale past two periods', () => {
    expect(deriveFeedStatus(feed({ lastReceivedAt: '2026-07-23T07:00:00Z' }), NOW)).toBe('stale')
  })

  it('will not call a badly late feed fresh, whatever the metadata says', () => {
    const late = feed({
      cadence: 'every 2 min',
      lastReceivedAt: '2026-07-20T12:00:00Z',
      status: 'fresh',
    })
    expect(deriveFeedStatus(late, NOW)).toBe('down')
  })

  it('keeps a worse upstream verdict', () => {
    const reportedDown = feed({ lastReceivedAt: '2026-07-23T11:59:00Z', status: 'down' })
    expect(deriveFeedStatus(reportedDown, NOW)).toBe('down')
  })

  it('falls back to the stored status when the cadence is unparseable', () => {
    expect(deriveFeedStatus(feed({ cadence: 'ad hoc', status: 'stale' }), NOW)).toBe('stale')
  })
})

describe('whether a feed verdict was checked or only repeated back', () => {
  it('is derived when the cadence parses', () => {
    expect(feedStatusBasis(feed({ cadence: 'every 2 min' }))).toBe('derived')
    expect(feedStatusBasis(feed({ cadence: 'hourly' }))).toBe('derived')
  })

  // Every feed on the stage instance reported this, so the entire column was a
  // verdict nobody had checked wearing the clothes of one that had been.
  it('is reported when the cadence is not a schedule', () => {
    expect(feedStatusBasis(feed({ cadence: 'not scheduled' }))).toBe('reported')
    expect(feedStatusBasis(feed({ cadence: '' }))).toBe('reported')
  })

  // The distinction has teeth: with no cadence the declared status stands
  // unaged, so a feed silent for a year still reads however it last claimed.
  it('matches when deriveFeedStatus stops aging the feed', () => {
    const silentForAYear = feed({
      cadence: 'not scheduled',
      status: 'fresh',
      lastReceivedAt: '2025-01-01T00:00:00Z',
    })

    expect(deriveFeedStatus(silentForAYear, NOW)).toBe('fresh')
    expect(feedStatusBasis(silentForAYear)).toBe('reported')
  })
})

describe('the label a declared interval renders as', () => {
  // The round trip is the contract in both directions, and it is the whole
  // reason this function exists rather than the control writing prose: a label
  // cadenceToMs cannot read silently switches the derivation back off.
  it.each([60, 300, 900, 3_600, 21_600, 86_400, 604_800])(
    'round-trips %i seconds through cadenceToMs',
    (seconds) => {
      expect(cadenceToMs(cadenceLabel(seconds))).toBe(seconds * 1000)
    }
  )

  it('uses the named intervals where there is a name', () => {
    expect(cadenceLabel(60)).toBe('minutely')
    expect(cadenceLabel(3_600)).toBe('hourly')
    expect(cadenceLabel(86_400)).toBe('daily')
  })

  it('reads in the largest unit that divides, not in seconds', () => {
    expect(cadenceLabel(300)).toBe('every 5 mins')
    expect(cadenceLabel(21_600)).toBe('every 6 hours')
  })

  it('has one representation for no expectation', () => {
    expect(cadenceLabel(0)).toBe('not scheduled')
    expect(cadenceToMs(cadenceLabel(0))).toBeNull()
  })

  // The point of the whole change: a declared interval is what lets
  // deriveFeedStatus judge a feed at all.
  it('turns an unjudgeable feed into a judged one', () => {
    const unjudged = feed({ cadence: 'not scheduled', status: 'fresh', lastReceivedAt: '2026-07-01T00:00:00Z' })
    expect(feedStatusBasis(unjudged)).toBe('reported')
    expect(deriveFeedStatus(unjudged, NOW)).toBe('fresh')

    const judged = { ...unjudged, cadence: cadenceLabel(3_600) }
    expect(feedStatusBasis(judged)).toBe('derived')
    expect(deriveFeedStatus(judged, NOW)).toBe('down')
  })
})
