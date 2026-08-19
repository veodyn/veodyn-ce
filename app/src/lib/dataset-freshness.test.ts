import { describe, expect, it } from 'vitest'
import { datasetForQueryId, resolveDatasetStatus } from '@/lib/dataset-freshness'
import type { Dataset, DatasetFreshness } from '@/types/catalog'
import type { Capture } from '@/types/capture'

const NOW = Date.parse('2026-07-24T12:00:00Z')
const HOUR = 3_600_000

function capture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'fleet-avl',
    name: 'Fleet AVL',
    source: 'Fleet Operations',
    cadence: 'every 1 min',
    lastReceivedAt: new Date(NOW).toISOString(),
    status: 'fresh',
    datasetCount: 1,
    ...overrides,
  }
}

function freshness(overrides: Partial<DatasetFreshness> = {}): DatasetFreshness {
  return {
    lastUpdatedAt: new Date(NOW).toISOString(),
    status: 'fresh',
    captureId: 'fleet-avl',
    ...overrides,
  }
}

function dataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: 'bike-share-availability',
    name: 'Bike Share Station Availability',
    description: '',
    domain: 'transit',
    schema: [],
    freshness: {
      lastUpdatedAt: '2026-07-22T05:55:00Z',
      status: 'stale',
      captureId: 'bikeshare-gbfs',
    },
    coverage: { start: '2025-01-05T00:00:00Z', end: '2026-07-22T05:55:00Z' },
    rowCount: 214_050,
    sources: [],
    tags: [],
    sampleQueryId: 42,
    origin: 'capture',
    writable: false,
    ...overrides,
  }
}

describe('resolveDatasetStatus', () => {
  it('overrules a fixture that claims Fresh three days into a one-minute cadence', () => {
    // The exact disagreement this exists to remove: the catalog printed
    // "Fresh, 3 days ago" for the dataset behind a capture that Feed Health was
    // simultaneously calling Down.
    const status = resolveDatasetStatus(
      freshness({ lastUpdatedAt: new Date(NOW - 72 * HOUR).toISOString() }),
      [capture()],
      NOW
    )

    expect(status).toBe('down')
  })

  it('ages the dataset, not the capture, so a live capture does not excuse a stalled table', () => {
    // The capture is delivering every minute and did so a second ago; the
    // dataset built from it has not moved in three days. The dataset is what
    // the badge is about.
    const status = resolveDatasetStatus(
      freshness({ lastUpdatedAt: new Date(NOW - 72 * HOUR).toISOString() }),
      [capture({ lastReceivedAt: new Date(NOW).toISOString() })],
      NOW
    )

    expect(status).toBe('down')
  })

  it('keeps Fresh when the dataset is inside two cadence periods', () => {
    const status = resolveDatasetStatus(
      freshness({ lastUpdatedAt: new Date(NOW - 60_000).toISOString() }),
      [capture()],
      NOW
    )

    expect(status).toBe('fresh')
  })

  it('believes a dataset that reports worse than the cadence implies', () => {
    const status = resolveDatasetStatus(freshness({ status: 'stale' }), [capture()], NOW)

    expect(status).toBe('stale')
  })

  it('believes a capture that reports down even when the dataset looks current', () => {
    // The capture knows something the timestamps do not. Passing the dataset's
    // status in as the capture's used to discard this entirely, so a capture
    // screaming Down rendered as Fresh.
    const status = resolveDatasetStatus(freshness({ status: 'fresh' }), [capture({ status: 'down' })], NOW)

    expect(status).toBe('down')
  })

  it('takes the worst of the three claims, not the last one checked', () => {
    const status = resolveDatasetStatus(
      freshness({ status: 'fresh', lastUpdatedAt: new Date(NOW - 5 * 60_000).toISOString() }),
      [capture({ status: 'stale' })],
      NOW
    )

    // Derived is stale (5 minutes on a one-minute cadence), declared capture is
    // stale, dataset says fresh: stale wins.
    expect(status).toBe('stale')
  })

  it('falls back to the declared status when no capture backs the dataset', () => {
    expect(resolveDatasetStatus(freshness({ captureId: undefined }), [capture()], NOW)).toBe('fresh')
    expect(resolveDatasetStatus(freshness(), [], NOW)).toBe('fresh')
    expect(resolveDatasetStatus(freshness(), undefined, NOW)).toBe('fresh')
  })
})

/**
 * The query-to-dataset join, which used to live in kpi-freshness.ts.
 *
 * It moved here with these cases because nothing about it names a KPI: a
 * dashboard widget asks the same question of the same edge, and the community
 * tree has to be able to ask it in a build with no KPI feature.
 */
describe('the dataset behind a saved query', () => {
  it('is found through the sample query the fixtures share', () => {
    expect(datasetForQueryId(42, [dataset()])?.id).toBe('bike-share-availability')
  })

  // Fails closed on purpose. Guessing at a dataset would put a freshness claim
  // on screen that nothing supports, which is a new version of the same bug.
  it('is null when no dataset reads that query', () => {
    expect(datasetForQueryId(999, [dataset()])).toBeNull()
  })

  it('is null for a caller with no query at all', () => {
    expect(datasetForQueryId(null, [dataset()])).toBeNull()
    expect(datasetForQueryId(undefined, [dataset()])).toBeNull()
  })

  it('is null before the catalog has loaded', () => {
    expect(datasetForQueryId(42, undefined)).toBeNull()
  })
})

/**
 * The shapes the running instance actually has, which the fixtures do not.
 *
 * A dataset's id is its ClickHouse table name and its sampleQueryId is the
 * query that BUILT it; the query asked about here is a different one that READS
 * it. On stage those two sets were disjoint (queries 43/44/45/46/50/79, datasets
 * on 14/21/22/23/31/32), so the sampleQueryId join resolved zero of six while
 * every fixture passed.
 */
describe('the join against real instance shapes', () => {
  const bikeshare = dataset({
    id: 'q_regional_demo_bikeshare_stations_32',
    sampleQueryId: 32,
    freshness: { lastUpdatedAt: '2026-07-22T05:55:00Z', status: 'stale', captureId: 'gbfs' },
  })
  const weather = dataset({
    id: 'q_regional_demo_environment_current_weather_31',
    sampleQueryId: 31,
    freshness: { lastUpdatedAt: '2026-08-01T05:00:00Z', status: 'fresh', captureId: 'owm' },
  })
  // Query 44 reads the table built by query 32. Nothing links 44 to 32 except
  // this FROM clause.
  const sql = new Map([
    [
      44,
      'SELECT uniqExact(station_id) AS stations\nFROM historical.q_regional_demo_bikeshare_stations_32\nWHERE captured_at = (SELECT max(captured_at) FROM historical.q_regional_demo_bikeshare_stations_32)',
    ],
  ])

  it('resolves the query to the table its SQL reads', () => {
    expect(datasetForQueryId(44, [bikeshare, weather], sql)?.id).toBe(
      'q_regional_demo_bikeshare_stations_32'
    )
  })

  it('is what the id-only join could not do', () => {
    // Same inputs, no SQL: exactly the zero-of-six outcome seen on stage.
    expect(datasetForQueryId(44, [bikeshare, weather])).toBeNull()
  })

  // A prefix match would put the caller on the wrong dataset, and these table
  // names differ only by their trailing query id.
  it('does not match a table whose name is a prefix of the one read', () => {
    const prefix = dataset({ id: 'q_regional_demo_bikeshare_stations_3', sampleQueryId: 3 })

    expect(datasetForQueryId(44, [prefix], sql)).toBeNull()
  })

  // The mock packs express the edge as a shared query id and their dataset ids
  // are slugs that appear in no SQL, so that path has to keep working.
  it('still honours the fixture join when the SQL names no known table', () => {
    expect(datasetForQueryId(42, [dataset()], new Map([[42, 'SELECT 1']]))?.id).toBe(
      'bike-share-availability'
    )
  })
})
