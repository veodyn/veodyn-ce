import type { MockQuery } from '../types/query-types'

// Second half of the neutral query fixtures (ids 6-10), split out of
// queries.ts to stay under the repo's file-size hook. queries.ts recombines
// this with queries-set-a.ts into the single mockQueries export.
export const mockQueriesSetB: MockQuery[] = [
  {
    id: 6,
    name: 'Bike Share Daily Trips',
    description: 'Daily bike trip counter from the bike share system',
    query: `SELECT date,
       system,
       daily_trips,
       weekly_trips,
       monthly_trips,
       total_trips
FROM bike_trip_counter
WHERE date >= today() - 30
ORDER BY date DESC;`,
    data_source_id: 1,
    schedule: { interval: 86400, time: '23:00', day_of_week: null, until: null },
    tags: ['bike-share', 'trips', 'daily'],
    is_archived: false,
    is_draft: false,
    is_favorite: true,
    is_safe: true,
    can_edit: true,
    user: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    last_modified_by: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    visualizations: [
      { id: 11, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2025-05-01T13:00:00Z', updated_at: '2025-05-01T13:00:00Z' },
      { id: 17, type: 'CHART', name: 'Daily Trip Trend', description: '', options: { globalSeriesType: 'bar', columnMapping: { date: 'x', daily_trips: 'y' } }, created_at: '2025-05-01T13:30:00Z', updated_at: '2025-05-01T13:30:00Z' },
    ],
    latest_query_data_id: 106,
    options: { parameters: [] },
    created_at: '2025-05-01T13:00:00Z',
    updated_at: '2026-03-10T13:00:00Z',
    retrieved_at: '2026-03-10T13:00:00Z',
    runtime: 0.445,
  },
  {
    id: 7,
    name: 'Traffic Cameras by City',
    description: 'CCTV traffic camera inventory and status by city',
    query: `SELECT city,
       direction,
       count(*) AS total_cameras,
       countIf(is_disabled = 0) AS active_cameras,
       countIf(is_disabled = 1) AS disabled_cameras,
       round(avg(speed_mph), 1) AS avg_speed
FROM camera_status
WHERE timestamp = (SELECT max(timestamp) FROM camera_status)
  AND city = '{{ city }}'
GROUP BY city, direction
ORDER BY total_cameras DESC;`,
    data_source_id: 1,
    schedule: null,
    tags: ['cameras', 'cctv', 'traffic'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: false,
    can_edit: true,
    user: { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
    last_modified_by: { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
    visualizations: [
      { id: 12, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2025-06-10T15:00:00Z', updated_at: '2025-06-10T15:00:00Z' },
    ],
    latest_query_data_id: 107,
    options: {
      parameters: [
        { name: 'city', title: 'City', type: 'enum', value: 'City A', enumOptions: 'City A\nCity B\nCity C\nCity D\nCity E\nCity F' },
      ],
    },
    created_at: '2025-06-10T15:00:00Z',
    updated_at: '2026-01-20T15:00:00Z',
    retrieved_at: '2026-01-20T15:00:00Z',
    runtime: 0.156,
  },
  {
    id: 8,
    name: 'Weather & Temperature History',
    description: 'Hourly weather observations for the past N days in the region',
    query: `SELECT toStartOfHour(timestamp) AS hour,
       round(avg(temp_f), 1) AS temp_f,
       round(avg(humidity), 0) AS humidity,
       any(condition) AS condition,
       round(avg(wind_speed), 1) AS wind_mph
FROM weather_observations
WHERE timestamp >= today() - {{ days }}
  AND timestamp BETWEEN {{ window.start }} AND {{ window.end }}
  AND status IN ({{ statuses }})
GROUP BY hour
ORDER BY hour;`,
    data_source_id: 1,
    schedule: null,
    tags: ['weather', 'environment'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: false,
    can_edit: true,
    user: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    last_modified_by: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    visualizations: [
      { id: 13, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2025-07-22T10:00:00Z', updated_at: '2025-07-22T10:00:00Z' },
      { id: 18, type: 'CHART', name: 'Temperature Chart', description: '', options: { globalSeriesType: 'line', columnMapping: { hour: 'x', temp_f: 'y', humidity: 'yRight' } }, created_at: '2025-07-22T10:30:00Z', updated_at: '2025-07-22T10:30:00Z' },
      // A chart exactly as Redash's own editor saves one. 'column' is Redash's
      // spelling for a vertical bar chart and the value it writes when nobody
      // touches the type dropdown, so it is the most common shape arriving from
      // a real backend. It drew as a line here until 2026-07-31, and no fixture
      // stored it, which is why nothing could show that.
      { id: 50, type: 'CHART', name: 'Temperature (node column chart)', description: '', options: { globalSeriesType: 'column', columnMapping: { hour: 'x', temp_f: 'y' } }, created_at: '2025-07-22T10:35:00Z', updated_at: '2025-07-22T10:35:00Z' },
      // A combo chart: Redash lets each series carry its own type. The bars drew
      // as a second line, so this rendered as two lines and nothing said so.
      { id: 51, type: 'CHART', name: 'Humidity bars over temperature line', description: '', options: { globalSeriesType: 'line', columnMapping: { hour: 'x', temp_f: 'y', humidity: 'y' }, seriesOptions: { humidity: { type: 'column' }, temp_f: { type: 'line' } } }, created_at: '2025-07-22T10:40:00Z', updated_at: '2025-07-22T10:40:00Z' },
    ],
    latest_query_data_id: 108,
    options: {
      parameters: [
        { name: 'days', title: 'Last N Days', type: 'number', value: 7 },
        // Stored as the dynamic sentinel, the way Redash stores a preset: the
        // window is resolved to dates at execution, not here. This is also the
        // only fixture exercising a range parameter in mock mode.
        { name: 'window', title: 'Service window', type: 'date-range', value: 'd_last_30_days' },
        // multiValuesOptions is how Redash marks "allow multiple values", and
        // the quoting it carries is applied by the backend from the schema, not
        // here. The only fixture exercising a multi-value parameter.
        {
          name: 'statuses',
          title: 'Statuses',
          type: 'enum',
          value: ['Open'],
          enumOptions: 'Open\nClosed\nPending',
          multiValuesOptions: { prefix: "'", suffix: "'", separator: ',' },
        },
      ],
    },
    created_at: '2025-07-22T10:00:00Z',
    updated_at: '2026-02-15T10:00:00Z',
    retrieved_at: '2026-02-15T10:00:00Z',
    runtime: 1.887,
  },
  {
    id: 9,
    name: 'Draft: Park & Ride Lot Utilization',
    description: 'Work in progress: park and ride facility analysis',
    query: `-- TODO: add utilization data from sensors
SELECT name, city, county, total_spaces, cost, lat, lon
FROM park_and_ride
ORDER BY total_spaces DESC;`,
    data_source_id: 1,
    schedule: null,
    tags: [],
    is_archived: false,
    is_draft: true,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    last_modified_by: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    visualizations: [
      { id: 14, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2026-03-01T16:00:00Z', updated_at: '2026-03-01T16:00:00Z' },
    ],
    latest_query_data_id: null,
    options: { parameters: [] },
    created_at: '2026-03-01T16:00:00Z',
    updated_at: '2026-03-01T16:00:00Z',
    retrieved_at: '',
    runtime: 0,
  },
  {
    id: 10,
    name: 'Archived: Old Incident Summary',
    description: 'Replaced by query #4',
    query: `SELECT count(*) AS total FROM traffic_incidents WHERE timestamp >= today() - 7;`,
    data_source_id: 1,
    schedule: null,
    tags: ['traffic'],
    is_archived: true,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    last_modified_by: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    visualizations: [
      { id: 15, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2024-01-20T10:00:00Z', updated_at: '2024-01-20T10:00:00Z' },
    ],
    latest_query_data_id: 110,
    options: { parameters: [] },
    created_at: '2024-01-20T10:00:00Z',
    updated_at: '2025-06-01T10:00:00Z',
    retrieved_at: '2025-06-01T10:00:00Z',
    runtime: 0.045,
  },
]
