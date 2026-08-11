// Demo fixture for KPI_HISTORY, the type registered after viz-fixtures-e's
// three. Query 21, visualization 62, result 121, gallery widget 62 on
// dashboard 5. The de-branded mirror of packs/la/viz-fixtures-f.ts: same ids,
// same query name, same columns and the same readings, with only the labels a
// reader sees changed.
import type { MockQuery } from '../types/query-types'
import type { MockQueryResult } from '../types/query-results'
import type { MockDashboardWidget } from '../types/dashboard-types'

const ANALYST = { id: 2, name: 'Jane Analyst', email: 'jane@example.com' }

// Read by both the query's saved visualization and its gallery widget: the two
// are the same picture, and a widget drawn from different options than the
// query page uses is the drift this pair of copies would otherwise invite.
//
// The target and the thresholds are constants rather than columns because they
// are properties of the measure, not of any one reading. Both are present:
// setting one without the other is the misconfiguration this type's `validate`
// reports, so a demo fixture must not model it.
const KPI_HISTORY_OPTIONS = {
  timeColumn: 'measured_at',
  valueColumn: 'on_time_pct',
  unit: '%',
  target: { value: 90, direction: 'higher-is-better' },
  thresholds: { atRisk: 88, breached: 82 },
}

// Fourteen daily readings that start on-track, fall through both thresholds and
// climb back over the target. A monotonic series would draw one band and prove
// nothing; this one crosses every band the options define, so all three shades
// and both dashed rules have something to sit against.
const ON_TIME_READINGS = [
  91.4, 90.8, 89.6, 87.9, 85.2, 81.4, 79.8, 82.6, 85.9, 88.1, 89.4, 90.2, 91.1, 92.3,
]

// 2026-03-05 through 2026-03-18, one reading a day at the 06:00 UTC rollup.
const FIRST_READING_DAY = 5

function readingAt(day: number): string {
  return `2026-03-${String(FIRST_READING_DAY + day).padStart(2, '0')}T06:00:00Z`
}

export const vizQueriesF: MockQuery[] = [
  {
    id: 21,
    name: 'Service On-Time Performance History',
    description: 'Daily share of rail departures within the on-time window',
    query: `SELECT toStartOfDay(departed_at) AS measured_at,
       round(100 * countIf(delay_seconds <= 300) / count(), 1) AS on_time_pct
FROM rail_departures
WHERE departed_at >= today() - 14
GROUP BY measured_at
ORDER BY measured_at;`,
    data_source_id: 1,
    schedule: { interval: 86400, time: '06:00', day_of_week: null, until: null },
    tags: ['rail', 'reliability'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: ANALYST,
    last_modified_by: ANALYST,
    visualizations: [
      {
        id: 62,
        type: 'KPI_HISTORY',
        name: 'On-Time Performance vs Target',
        description: '',
        options: KPI_HISTORY_OPTIONS,
        created_at: '2026-04-02T09:30:00Z',
        updated_at: '2026-04-02T09:30:00Z',
      },
    ],
    latest_query_data_id: 121,
    options: { parameters: [] },
    created_at: '2026-04-02T09:30:00Z',
    updated_at: '2026-04-02T09:30:00Z',
    retrieved_at: '2026-04-02T09:30:00Z',
    runtime: 0.198,
  },
]

export const vizQueryResultsF: Record<number, MockQueryResult> = {
  121: {
    id: 121,
    query_hash: 'hash_121',
    query: 'SELECT toStartOfDay(departed_at) AS measured_at, round(...) AS on_time_pct...',
    data: {
      columns: [
        { name: 'measured_at', friendly_name: 'Measured At', type: 'datetime' },
        { name: 'on_time_pct', friendly_name: 'On Time (%)', type: 'float' },
      ],
      rows: ON_TIME_READINGS.map((onTimePct, day) => ({
        measured_at: readingAt(day),
        on_time_pct: onTimePct,
      })),
    },
    data_source_id: 1,
    runtime: 0.198,
    retrieved_at: '2026-04-02T09:30:00Z',
  },
}

export const vizGalleryWidgetsF: MockDashboardWidget[] = [
  {
    id: 62,
    dashboard_id: 5,
    visualization: {
      id: 62,
      query: { id: 21 },
      type: 'KPI_HISTORY',
      name: 'On-Time Performance vs Target',
      description: '',
      options: KPI_HISTORY_OPTIONS,
    },
    width: 1,
    options: { position: { col: 0, row: 50, sizeX: 3, sizeY: 10 } },
  },
]
