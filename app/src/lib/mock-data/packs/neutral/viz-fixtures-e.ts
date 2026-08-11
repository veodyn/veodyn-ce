// Demo fixtures for the three visualization types that had no fixture at all:
// HEATMAP, BOXPLOT and COHORT. Queries 18-20, visualizations 59-61, results
// 118-120, gallery widgets 59-61 on dashboard 5. The de-branded mirror of
// packs/la/viz-fixtures-e.ts: same ids, same query names, same columns and the
// same row counts, with only the labels a reader sees changed.
import type { MockQuery } from '../types/query-types'
import type { MockQueryResult } from '../types/query-results'
import type { MockDashboardWidget } from '../types/dashboard-types'

const ANALYST = { id: 2, name: 'Jane Analyst', email: 'jane@example.com' }

// Each type's options live once and are read by both the query's saved
// visualization and its gallery widget: the two are the same picture, and a
// widget drawn from different options than the query page uses is the drift
// this pair of copies would otherwise invite.
const HEATMAP_OPTIONS = {
  columnMapping: { hour: 'x', station: 'y', boardings: 'value' },
  aggregation: 'sum',
  showValues: 'auto',
  clipOutliers: false,
  sortRows: 'total',
}
const BOXPLOT_OPTIONS = { columnMapping: { corridor: 'category', travel_minutes: 'value' } }
const COHORT_OPTIONS = {
  dateColumn: 'cohort_week',
  stageColumn: 'week_number',
  totalColumn: 'riders',
  valueColumn: 'retained',
  timeInterval: 'weekly',
  mode: 'simple',
}

const HEATMAP_HOURS = ['06:00', '07:00', '08:00', '09:00', '16:00', '17:00', '18:00', '19:00']
const HEATMAP_STATIONS = [
  'Station A',
  'Station B',
  'Station C',
  'Station D',
  'Station E',
  'Station F',
]
// Two peaks (the 08:00 and 17:00 columns) rather than a flat wash, so the grid
// reads as a commute and the colour ramp has something to say.
const HEATMAP_PEAK = [0.55, 0.9, 1, 0.7, 0.75, 1, 0.95, 0.6]
// Deliberately not in descending order: sortRows: 'total' then visibly reorders
// the grid instead of reproducing the order the rows arrive in.
const HEATMAP_BASE = [1400, 860, 1220, 500, 1040, 680]

// Nine samples per corridor, the same spread shifted per corridor so every box
// has a real distribution rather than a single value.
const BOXPLOT_SPREAD = [-6, -4, -3, -1, 0, 1, 3, 4, 7]
const BOXPLOT_CORRIDORS = ['Corridor A', 'Corridor B', 'Corridor C', 'Corridor D', 'Corridor E']
// One corridor carries a single incident-day sample far outside its own IQR,
// so the renderer's outlier dot has something to draw.
const BOXPLOT_INCIDENT = [0, 0, 0, 0, 34]

const COHORT_WEEKS = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26', '2026-02-02']
const COHORT_SIZES = [1840, 1620, 1975, 1510, 1730]
// Week 0 is the cohort itself, so it is always 100%. Each later week keeps a
// fixed share, and each cohort reports one fewer week than the one before it,
// which is what gives the grid its triangle.
const COHORT_RETENTION = [1, 0.62, 0.48, 0.4, 0.35]

export const vizQueriesE: MockQuery[] = [
  {
    id: 18,
    name: 'Station Boardings by Hour',
    description: 'Weekday boardings per rail station across the commute hours',
    query: `SELECT formatDateTime(toStartOfHour(timestamp), '%H:00') AS hour,
       station,
       sum(boardings) AS boardings
FROM rail_boardings
WHERE toDate(timestamp) >= today() - 7
GROUP BY hour, station
ORDER BY station, hour;`,
    data_source_id: 1,
    schedule: { interval: 86400, time: '02:00', day_of_week: null, until: null },
    tags: ['rail', 'ridership'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: ANALYST,
    last_modified_by: ANALYST,
    visualizations: [
      {
        id: 59,
        type: 'HEATMAP',
        name: 'Boardings Heatmap',
        description: '',
        options: HEATMAP_OPTIONS,
        created_at: '2026-04-02T09:00:00Z',
        updated_at: '2026-04-02T09:00:00Z',
      },
    ],
    latest_query_data_id: 118,
    options: { parameters: [] },
    created_at: '2026-04-02T09:00:00Z',
    updated_at: '2026-04-02T09:00:00Z',
    retrieved_at: '2026-04-02T09:00:00Z',
    runtime: 0.612,
  },
  {
    id: 19,
    name: 'Corridor Travel Time Spread',
    description: 'Peak-hour travel times sampled per highway corridor over the past month',
    query: `SELECT corridor,
       travel_minutes
FROM corridor_travel_times
WHERE sampled_at >= today() - 30
ORDER BY corridor;`,
    data_source_id: 1,
    schedule: null,
    tags: ['highway', 'travel-time'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: ANALYST,
    last_modified_by: ANALYST,
    visualizations: [
      {
        id: 60,
        type: 'BOXPLOT',
        name: 'Travel Time Distribution',
        description: '',
        options: BOXPLOT_OPTIONS,
        created_at: '2026-04-02T09:10:00Z',
        updated_at: '2026-04-02T09:10:00Z',
      },
    ],
    latest_query_data_id: 119,
    options: { parameters: [] },
    created_at: '2026-04-02T09:10:00Z',
    updated_at: '2026-04-02T09:10:00Z',
    retrieved_at: '2026-04-02T09:10:00Z',
    runtime: 0.287,
  },
  {
    id: 20,
    name: 'Rider Retention by Signup Week',
    description: 'Transit card riders still travelling N weeks after their first trip',
    query: `SELECT toMonday(signup_at) AS cohort_week,
       dateDiff('week', toMonday(signup_at), toMonday(trip_at)) AS week_number,
       any(cohort_size) AS riders,
       uniqExact(rider_id) AS retained
FROM rider_trips
GROUP BY cohort_week, week_number
ORDER BY cohort_week, week_number;`,
    data_source_id: 1,
    schedule: null,
    tags: ['riders', 'retention'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: ANALYST,
    last_modified_by: ANALYST,
    visualizations: [
      {
        id: 61,
        type: 'COHORT',
        name: 'Weekly Retention',
        description: '',
        options: COHORT_OPTIONS,
        created_at: '2026-04-02T09:20:00Z',
        updated_at: '2026-04-02T09:20:00Z',
      },
    ],
    latest_query_data_id: 120,
    options: { parameters: [] },
    created_at: '2026-04-02T09:20:00Z',
    updated_at: '2026-04-02T09:20:00Z',
    retrieved_at: '2026-04-02T09:20:00Z',
    runtime: 1.104,
  },
]

export const vizQueryResultsE: Record<number, MockQueryResult> = {
  118: {
    id: 118,
    query_hash: 'hash_118',
    query: "SELECT formatDateTime(toStartOfHour(timestamp), '%H:00') AS hour, station...",
    data: {
      columns: [
        { name: 'hour', friendly_name: 'Hour', type: 'string' },
        { name: 'station', friendly_name: 'Station', type: 'string' },
        { name: 'boardings', friendly_name: 'Boardings', type: 'integer' },
      ],
      rows: HEATMAP_STATIONS.flatMap((station, s) =>
        HEATMAP_HOURS.map((hour, h) => ({
          hour,
          station,
          boardings: Math.round(HEATMAP_BASE[s] * HEATMAP_PEAK[h]),
        }))
      ),
    },
    data_source_id: 1,
    runtime: 0.612,
    retrieved_at: '2026-04-02T09:00:00Z',
  },

  119: {
    id: 119,
    query_hash: 'hash_119',
    query: 'SELECT corridor, travel_minutes FROM corridor_travel_times...',
    data: {
      columns: [
        { name: 'corridor', friendly_name: 'Corridor', type: 'string' },
        { name: 'travel_minutes', friendly_name: 'Travel Time (min)', type: 'integer' },
      ],
      rows: BOXPLOT_CORRIDORS.flatMap((corridor, c) =>
        BOXPLOT_SPREAD.map((offset, i) => ({
          corridor,
          travel_minutes:
            28 + c * 6 + offset + (i === BOXPLOT_SPREAD.length - 1 ? BOXPLOT_INCIDENT[c] : 0),
        }))
      ),
    },
    data_source_id: 1,
    runtime: 0.287,
    retrieved_at: '2026-04-02T09:10:00Z',
  },

  120: {
    id: 120,
    query_hash: 'hash_120',
    query: 'SELECT toMonday(signup_at) AS cohort_week, dateDiff(...) AS week_number...',
    data: {
      columns: [
        { name: 'cohort_week', friendly_name: 'Signup Week', type: 'date' },
        { name: 'week_number', friendly_name: 'Week', type: 'integer' },
        { name: 'riders', friendly_name: 'Cohort Size', type: 'integer' },
        { name: 'retained', friendly_name: 'Retained Riders', type: 'integer' },
      ],
      rows: COHORT_WEEKS.flatMap((cohortWeek, c) =>
        COHORT_RETENTION.slice(0, COHORT_WEEKS.length - c).map((share, stage) => ({
          cohort_week: cohortWeek,
          week_number: stage,
          riders: COHORT_SIZES[c],
          retained: Math.round(COHORT_SIZES[c] * share),
        }))
      ),
    },
    data_source_id: 1,
    runtime: 1.104,
    retrieved_at: '2026-04-02T09:20:00Z',
  },
}

export const vizGalleryWidgetsE: MockDashboardWidget[] = [
  {
    id: 59,
    dashboard_id: 5,
    visualization: {
      id: 59,
      query: { id: 18 },
      type: 'HEATMAP',
      name: 'Boardings Heatmap',
      description: '',
      options: HEATMAP_OPTIONS,
    },
    width: 1,
    options: { position: { col: 3, row: 30, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 60,
    dashboard_id: 5,
    visualization: {
      id: 60,
      query: { id: 19 },
      type: 'BOXPLOT',
      name: 'Travel Time Distribution',
      description: '',
      options: BOXPLOT_OPTIONS,
    },
    width: 1,
    options: { position: { col: 0, row: 40, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 61,
    dashboard_id: 5,
    visualization: {
      id: 61,
      query: { id: 20 },
      type: 'COHORT',
      name: 'Weekly Retention',
      description: '',
      options: COHORT_OPTIONS,
    },
    width: 1,
    options: { position: { col: 3, row: 40, sizeX: 3, sizeY: 10 } },
  },
]
