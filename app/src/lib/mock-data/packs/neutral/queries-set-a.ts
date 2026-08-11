import type { MockQuery } from '../types/query-types'

// First half of the neutral query fixtures (ids 1-5), split out of queries.ts
// to stay under the repo's file-size hook. queries.ts recombines this with
// queries-set-b.ts into the single mockQueries export.
export const mockQueriesSetA: MockQuery[] = [
  {
    id: 1,
    name: 'Rail Network Daily Ridership',
    description: 'Daily vehicle count by rail line over the past 30 days from ClickHouse historical data',
    query: `SELECT toDate(timestamp) AS date,
       route_tag AS line,
       count(DISTINCT device_id) AS vehicle_count,
       avg(speed) AS avg_speed
FROM vehicle_locations
WHERE source = 'Rail SCADA'
  AND timestamp >= today() - 30
GROUP BY date, line
ORDER BY date, line;`,
    data_source_id: 1,
    schedule: { interval: 86400, time: '06:00', day_of_week: null, until: null },
    tags: ['metro', 'rail', 'ridership'],
    is_archived: false,
    is_draft: false,
    is_favorite: true,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    last_modified_by: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    visualizations: [
      { id: 1, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2024-06-01T10:00:00Z', updated_at: '2024-06-01T10:00:00Z' },
      { id: 2, type: 'CHART', name: 'Ridership Trend', description: 'Daily vehicle count by line', options: { globalSeriesType: 'line', columnMapping: { date: 'x', vehicle_count: 'y', line: 'series' } }, created_at: '2024-06-01T10:30:00Z', updated_at: '2025-12-15T14:00:00Z' },
    ],
    latest_query_data_id: 101,
    options: { parameters: [] },
    created_at: '2024-06-01T10:00:00Z',
    updated_at: '2026-03-15T06:00:00Z',
    retrieved_at: '2026-03-18T06:00:00Z',
    runtime: 0.342,
  },
  {
    id: 2,
    name: 'Air Quality Index by Station',
    description: 'Hourly AQI readings from monitoring stations across the region',
    query: `SELECT toStartOfHour(timestamp) AS hour,
       station,
       parameter_name,
       avg(aqi) AS avg_aqi,
       max(aqi) AS max_aqi,
       any(category) AS category
FROM air_quality_readings
WHERE timestamp >= today() - 7
GROUP BY hour, station, parameter_name
ORDER BY hour DESC, avg_aqi DESC;`,
    data_source_id: 1,
    schedule: { interval: 3600, time: null, day_of_week: null, until: null },
    tags: ['air-quality', 'environment', 'health'],
    is_archived: false,
    is_draft: false,
    is_favorite: true,
    is_safe: true,
    can_edit: true,
    user: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    last_modified_by: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    visualizations: [
      { id: 3, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2024-07-10T09:00:00Z', updated_at: '2024-07-10T09:00:00Z' },
      { id: 4, type: 'CHART', name: 'AQI Trend', description: '', options: { globalSeriesType: 'area', columnMapping: { hour: 'x', avg_aqi: 'y', station: 'series' } }, created_at: '2024-07-10T09:30:00Z', updated_at: '2025-11-20T16:00:00Z' },
    ],
    latest_query_data_id: 102,
    options: { parameters: [] },
    created_at: '2024-07-10T09:00:00Z',
    updated_at: '2026-03-14T07:00:00Z',
    retrieved_at: '2026-03-18T07:00:00Z',
    runtime: 1.205,
  },
  {
    id: 3,
    name: 'Bike Share Station Availability',
    description: 'Current bike and dock availability across all bike share stations',
    query: `SELECT station_name,
       lat, lon,
       num_bikes_available AS bikes,
       num_docks_available AS docks,
       num_bikes_available + num_docks_available AS total_capacity,
       round(num_bikes_available * 100.0 / (num_bikes_available + num_docks_available), 1) AS pct_full,
       system
FROM bike_share_snapshots
WHERE timestamp = (SELECT max(timestamp) FROM bike_share_snapshots)
ORDER BY station_name;`,
    data_source_id: 1,
    schedule: { interval: 300, time: null, day_of_week: null, until: null },
    tags: ['bike-share', 'availability', 'real-time'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    last_modified_by: { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
    visualizations: [
      { id: 5, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2025-01-05T14:00:00Z', updated_at: '2025-01-05T14:00:00Z' },
      { id: 16, type: 'MAP', name: 'Station Map', description: 'Bike share station locations', options: { latColName: 'lat', lonColName: 'lon', popup: { enabled: true, template: '{{ station_name }}' } }, created_at: '2025-01-06T10:00:00Z', updated_at: '2025-01-06T10:00:00Z' },
    ],
    latest_query_data_id: 103,
    options: { parameters: [] },
    created_at: '2025-01-05T14:00:00Z',
    updated_at: '2026-03-18T08:00:00Z',
    retrieved_at: '2026-03-18T08:00:00Z',
    runtime: 0.567,
  },
  {
    id: 4,
    name: 'Traffic Incidents This Week',
    description: 'Traffic incidents for the current week by severity and category, from multiple sources',
    query: `SELECT toDate(timestamp) AS date,
       category,
       severity,
       source,
       count(*) AS incident_count
FROM traffic_incidents
WHERE timestamp >= toStartOfWeek(today())
GROUP BY date, category, severity, source
ORDER BY date, incident_count DESC;`,
    data_source_id: 1,
    schedule: { interval: 1800, time: null, day_of_week: null, until: null },
    tags: ['traffic', 'incidents', 'safety'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'Admin User', email: 'admin@example.com' },
    last_modified_by: { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
    visualizations: [
      { id: 6, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2025-03-20T11:00:00Z', updated_at: '2025-03-20T11:00:00Z' },
      { id: 7, type: 'CHART', name: 'Incidents by Day', description: '', options: { globalSeriesType: 'bar', columnMapping: { date: 'x', incident_count: 'y', category: 'series' }, stacking: 'stack' }, created_at: '2025-03-20T11:30:00Z', updated_at: '2025-03-20T11:30:00Z' },
    ],
    latest_query_data_id: 104,
    options: { parameters: [] },
    created_at: '2025-03-20T11:00:00Z',
    updated_at: '2026-02-28T15:00:00Z',
    retrieved_at: '2026-02-28T15:00:00Z',
    runtime: 2.103,
  },
  {
    id: 5,
    name: 'Fleet Vehicle Status Summary',
    description: 'Current status of fleet vehicles: driving vs stationary',
    query: `SELECT
  countIf(is_driving = 1) AS driving,
  countIf(is_driving = 0) AS stationary,
  count(*) AS total_vehicles,
  round(avg(speed), 1) AS avg_speed_mph
FROM vehicle_locations
WHERE source = 'Fleet'
  AND timestamp >= now() - INTERVAL 5 MINUTE;`,
    data_source_id: 1,
    schedule: { interval: 60, time: null, day_of_week: null, until: null },
    tags: ['fleet', 'vehicles', 'real-time'],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
    last_modified_by: { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
    visualizations: [
      { id: 8, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: '2025-04-15T09:00:00Z', updated_at: '2025-04-15T09:00:00Z' },
      { id: 9, type: 'CHART', name: 'Status Pie', description: '', options: { globalSeriesType: 'pie', columnMapping: { status: 'x', count: 'y' } }, created_at: '2025-04-15T09:30:00Z', updated_at: '2025-04-15T09:30:00Z' },
      { id: 10, type: 'COUNTER', name: 'Total Vehicles', description: '', options: { counterLabel: 'Active Fleet Vehicles', counterColName: 'total_vehicles', rowNumber: 1 }, created_at: '2025-04-15T10:00:00Z', updated_at: '2025-04-15T10:00:00Z' },
    ],
    latest_query_data_id: 105,
    options: { parameters: [] },
    created_at: '2025-04-15T09:00:00Z',
    updated_at: '2026-03-17T09:00:00Z',
    retrieved_at: '2026-03-18T09:00:00Z',
    runtime: 0.089,
  },
]
