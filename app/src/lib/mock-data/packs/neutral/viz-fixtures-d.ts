// Neutral counterpart of packs/la/viz-fixtures-d.ts: gallery fixtures for the
// three visualization types that shipped with a renderer and an editor but no
// demo data at all (PIVOT, DETAILS, FUNNEL).
//
// Same ids, column names, column types and row counts as the LA file, because
// neutral.test.ts cross-checks the packs. Only the human-facing values differ.
import type { MockDashboardWidget } from '../types/dashboard-types'
import type { MockQuery } from '../types/query-types'
import type { MockQueryResult } from '../types/query-results'

// Four row keys against three column keys: the smallest grid that is actually a
// pivot rather than a list, so every header and every cell has something to
// prove. Written as a matrix because 12 hand-typed rows hide a transposition.
const PIVOT_LINES = ['Line 1', 'Line 2', 'Line 3', 'Line 4']
const PIVOT_DAYPARTS = ['AM Peak', 'Midday', 'PM Peak']
const PIVOT_BOARDINGS = [
  [18400, 9100, 21200],
  [26800, 12400, 28900],
  [14200, 7600, 16100],
  [8300, 4200, 9500],
]

const ANALYST = { id: 2, name: 'Jane Analyst', email: 'jane@example.com' }
const DEVELOPER = { id: 3, name: 'Bob Developer', email: 'bob@example.com' }

export const vizQueriesD: MockQuery[] = [
  {
    id: 15,
    name: 'Rail Boardings by Line and Daypart',
    description: 'Weekday rail network boardings, pivoted by line against daypart',
    query: `SELECT route_name AS line,
       daypart,
       sum(boardings) AS boardings
FROM rail_boardings
WHERE service_day = 'Weekday'
GROUP BY line, daypart
ORDER BY line, daypart;`,
    data_source_id: 1,
    schedule: { interval: 86400, time: '04:00', day_of_week: null, until: null },
    tags: ['rail', 'ridership', 'pivot'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: ANALYST,
    last_modified_by: ANALYST,
    visualizations: [
      { id: 56, type: 'PIVOT', name: 'Boardings by Line / Daypart', description: '', options: { rowField: 'line', colField: 'daypart', valueField: 'boardings', aggregation: 'sum' }, created_at: '2026-04-02T09:00:00Z', updated_at: '2026-04-02T09:00:00Z' },
    ],
    latest_query_data_id: 115,
    options: { parameters: [] },
    created_at: '2026-04-02T09:00:00Z',
    updated_at: '2026-06-18T09:00:00Z',
    retrieved_at: '2026-06-18T09:00:00Z',
    runtime: 0.612,
  },
  {
    id: 16,
    name: 'Rail Station Facility Details',
    description: 'One record per rail station: platforms, boardings and access notes',
    query: `SELECT station_id,
       station_name,
       city,
       platform_count,
       daily_boardings,
       opened_on,
       accessibility,
       notes
FROM rail_stations
ORDER BY daily_boardings DESC
LIMIT 3;`,
    data_source_id: 1,
    schedule: null,
    tags: ['rail', 'stations', 'reference'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: DEVELOPER,
    last_modified_by: DEVELOPER,
    visualizations: [
      // `columns` names the columns to show, in the renderer's own order. It
      // deliberately omits station_id, so the option is exercised rather than
      // being an expensive way of writing "show everything".
      { id: 57, type: 'DETAILS', name: 'Station Record', description: '', options: { columns: ['station_name', 'city', 'platform_count', 'daily_boardings', 'opened_on', 'accessibility', 'notes'] }, created_at: '2026-04-09T11:00:00Z', updated_at: '2026-04-09T11:00:00Z' },
    ],
    latest_query_data_id: 116,
    options: { parameters: [] },
    created_at: '2026-04-09T11:00:00Z',
    updated_at: '2026-05-21T11:00:00Z',
    retrieved_at: '2026-05-21T11:00:00Z',
    runtime: 0.087,
  },
  {
    id: 17,
    name: 'Trip Planner Conversion Funnel',
    description: 'Where sessions drop out of the trip planner, step by step',
    query: `SELECT step,
       sessions,
       round(100 * sessions / first_value(sessions) OVER (ORDER BY step_order), 1) AS conversion_pct
FROM trip_planner_funnel
WHERE week_start = toMonday(today()) - 7
ORDER BY step_order;`,
    data_source_id: 1,
    schedule: { interval: 604800, time: '06:00', day_of_week: 'Monday', until: null },
    tags: ['trip-planner', 'funnel', 'product'],
    is_archived: false,
    is_draft: false,
    is_favorite: true,
    is_safe: true,
    can_edit: true,
    user: ANALYST,
    last_modified_by: ANALYST,
    visualizations: [
      { id: 58, type: 'FUNNEL', name: 'Planner Drop-off', description: '', options: { stepColumn: 'step', valueColumn: 'sessions', sortOrder: 'desc' }, created_at: '2026-04-15T08:00:00Z', updated_at: '2026-04-15T08:00:00Z' },
    ],
    latest_query_data_id: 117,
    options: { parameters: [] },
    created_at: '2026-04-15T08:00:00Z',
    updated_at: '2026-06-29T08:00:00Z',
    retrieved_at: '2026-06-29T08:00:00Z',
    runtime: 0.934,
  },
]

export const vizQueryResultsD: Record<number, MockQueryResult> = {
  115: {
    id: 115,
    query_hash: 'hash_115',
    query: 'SELECT route_name AS line, daypart, sum(boardings) AS boardings...',
    data: {
      columns: [
        { name: 'line', friendly_name: 'Line', type: 'string' },
        { name: 'daypart', friendly_name: 'Daypart', type: 'string' },
        { name: 'boardings', friendly_name: 'Boardings', type: 'integer' },
      ],
      rows: PIVOT_LINES.flatMap((line, lineIndex) =>
        PIVOT_DAYPARTS.map((daypart, daypartIndex) => ({
          line,
          daypart,
          boardings: PIVOT_BOARDINGS[lineIndex][daypartIndex],
        }))
      ),
    },
    data_source_id: 1,
    runtime: 0.612,
    retrieved_at: '2026-06-18T09:00:00Z',
  },

  116: {
    id: 116,
    query_hash: 'hash_116',
    query: 'SELECT station_id, station_name, city, platform_count...',
    data: {
      columns: [
        { name: 'station_id', friendly_name: 'Station ID', type: 'string' },
        { name: 'station_name', friendly_name: 'Station', type: 'string' },
        { name: 'city', friendly_name: 'City', type: 'string' },
        { name: 'platform_count', friendly_name: 'Platforms', type: 'integer' },
        { name: 'daily_boardings', friendly_name: 'Daily Boardings', type: 'integer' },
        { name: 'opened_on', friendly_name: 'Opened', type: 'date' },
        { name: 'accessibility', friendly_name: 'Accessibility', type: 'string' },
        { name: 'notes', friendly_name: 'Notes', type: 'string' },
      ],
      // Three rows so the renderer's prev/next pager is reachable, and one null
      // so its "null" branch has a fixture behind it.
      rows: [
        { station_id: 'STN-0071', station_name: 'Central Station', city: 'City A', platform_count: 8, daily_boardings: 41200, opened_on: '1939-05-07', accessibility: 'Full', notes: 'Shared with regional and intercity rail; bus plaza on the north side.' },
        { station_id: 'STN-0114', station_name: 'Financial District', city: 'City A', platform_count: 4, daily_boardings: 33800, opened_on: '1990-07-14', accessibility: 'Full', notes: null },
        { station_id: 'STN-0233', station_name: 'Harbor Centre', city: 'City B', platform_count: 2, daily_boardings: 9400, opened_on: '1990-07-14', accessibility: 'Partial', notes: 'North platform lift out of service pending the 2026 rebuild.' },
      ],
    },
    data_source_id: 1,
    runtime: 0.087,
    retrieved_at: '2026-05-21T11:00:00Z',
  },

  117: {
    id: 117,
    query_hash: 'hash_117',
    query: 'SELECT step, sessions, round(100 * sessions / first_value(sessions)...',
    data: {
      columns: [
        { name: 'step', friendly_name: 'Step', type: 'string' },
        { name: 'sessions', friendly_name: 'Sessions', type: 'integer' },
        { name: 'conversion_pct', friendly_name: 'Conversion %', type: 'float' },
      ],
      // Strictly decreasing, or it is not a funnel. conversion_pct is each step
      // over the first, which is what the renderer prints beside the bar, so a
      // mismatch here would be visible on screen.
      rows: [
        { step: 'Opened planner', sessions: 48200, conversion_pct: 100 },
        { step: 'Entered origin and destination', sessions: 39100, conversion_pct: 81.1 },
        { step: 'Compared itineraries', sessions: 27600, conversion_pct: 57.3 },
        { step: 'Viewed live departures', sessions: 18400, conversion_pct: 38.2 },
        { step: 'Started the trip', sessions: 9700, conversion_pct: 20.1 },
      ],
    },
    data_source_id: 1,
    runtime: 0.934,
    retrieved_at: '2026-06-29T08:00:00Z',
  },
}

export const vizGalleryWidgetsD: MockDashboardWidget[] = [
  {
    id: 56,
    dashboard_id: 5,
    visualization: { id: 56, query: { id: 15 }, type: 'PIVOT', name: 'Boardings by Line / Daypart', description: '', options: { rowField: 'line', colField: 'daypart', valueField: 'boardings', aggregation: 'sum' } },
    width: 1,
    options: { position: { col: 0, row: 20, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 57,
    dashboard_id: 5,
    visualization: { id: 57, query: { id: 16 }, type: 'DETAILS', name: 'Station Record', description: '', options: { columns: ['station_name', 'city', 'platform_count', 'daily_boardings', 'opened_on', 'accessibility', 'notes'] } },
    width: 1,
    options: { position: { col: 3, row: 20, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 58,
    dashboard_id: 5,
    visualization: { id: 58, query: { id: 17 }, type: 'FUNNEL', name: 'Planner Drop-off', description: '', options: { stepColumn: 'step', valueColumn: 'sessions', sortOrder: 'desc' } },
    width: 1,
    options: { position: { col: 0, row: 30, sizeX: 3, sizeY: 10 } },
  },
]
