// De-branded twin of packs/la/viz-fixtures-c.ts: SANKEY, CHOROPLETH,
// SUNBURST_SEQUENCE and WORD_CLOUD, the four types that had no fixture at all.
// Same ids, column names, column types and row counts as the LA pack (queries
// 11-14, visualizations and widgets 52-55, results 111-114, dashboard 5); only
// the human-facing labels and values differ. Types come from the LA pack, as
// every file in this pack does.
import type { MockDashboardWidget } from '../types/dashboard-types'
import type { MockQuery } from '../types/query-types'
import type { MockQueryResult } from '../types/query-results'

const ANALYST = { id: 2, name: 'Jane Analyst', email: 'jane@example.com' }
const AUTHORED = '2026-06-01T09:00:00Z'

// The fields that are identical across all four queries, spread into each
// below so the interesting part of a fixture is not buried under scaffolding.
const QUERY_BASE = {
  data_source_id: 1,
  schedule: null,
  is_archived: false,
  is_draft: false,
  is_favorite: false,
  is_safe: true,
  can_edit: true,
  user: ANALYST,
  last_modified_by: ANALYST,
  options: { parameters: [] },
  created_at: AUTHORED,
  updated_at: AUTHORED,
  retrieved_at: AUTHORED,
}

// Each options object is shared by the query's visualization and by the gallery
// widget that draws it, so the two cannot drift apart.
const SANKEY_OPTIONS = {
  columnMapping: { source_node: 'source', target_node: 'target', trips: 'value' },
}
// targetField names the geojson property the key column is matched against.
// public/geo/world-countries.geojson carries name, iso_a2 and iso_a3; the
// country strings in result 112 are spelled exactly as its `name` values.
const CHOROPLETH_OPTIONS = {
  mapType: 'world-countries',
  keyColumn: 'country',
  targetField: 'name',
  valueColumn: 'shipments',
}
const SUNBURST_OPTIONS = { valueColumn: 'value' }
const WORD_CLOUD_OPTIONS = {
  column: 'term',
  frequenciesColumn: 'mentions',
  wordLengthLimit: { min: 3, max: 20 },
}

export const vizQueriesC: MockQuery[] = [
  {
    ...QUERY_BASE,
    id: 11,
    name: 'Transit Transfer Flows',
    description: 'How riders reach the two busiest interchange stations, and which line they board',
    query: `SELECT access_mode AS source_node,
       station AS target_node,
       sum(trips) AS trips
FROM rail_station_access
WHERE service_date >= today() - 7
GROUP BY source_node, target_node
UNION ALL
SELECT station AS source_node,
       line AS target_node,
       sum(trips) AS trips
FROM rail_station_boardings
WHERE service_date >= today() - 7
GROUP BY source_node, target_node;`,
    tags: ['rail', 'transfers'],
    visualizations: [
      { id: 52, type: 'SANKEY', name: 'Transfer Flows', description: '', options: SANKEY_OPTIONS, created_at: AUTHORED, updated_at: AUTHORED },
    ],
    latest_query_data_id: 111,
    runtime: 0.612,
  },
  {
    ...QUERY_BASE,
    id: 12,
    name: 'Fleet Parts Shipments by Country',
    description: 'Rolling-stock parts received at the maintenance depots, by country of origin',
    query: `SELECT origin_country AS country,
       count(*) AS shipments
FROM fleet_parts_shipments
WHERE received_at >= today() - 90
GROUP BY country
ORDER BY shipments DESC;`,
    tags: ['fleet', 'supply-chain'],
    visualizations: [
      { id: 53, type: 'CHOROPLETH', name: 'Shipments by Country', description: '', options: CHOROPLETH_OPTIONS, created_at: AUTHORED, updated_at: AUTHORED },
    ],
    latest_query_data_id: 112,
    runtime: 0.238,
  },
  {
    ...QUERY_BASE,
    id: 13,
    name: 'Rider Journey Paths',
    description: 'The most common origin, line and destination chains on the rail network',
    query: `SELECT path_id AS sequence,
       hop AS stage,
       stop_name AS node,
       trip_count AS value
FROM rider_journey_paths
WHERE service_date = today() - 1
ORDER BY sequence, stage;`,
    tags: ['rail', 'journeys'],
    visualizations: [
      { id: 54, type: 'SUNBURST_SEQUENCE', name: 'Journey Paths', description: '', options: SUNBURST_OPTIONS, created_at: AUTHORED, updated_at: AUTHORED },
    ],
    latest_query_data_id: 113,
    runtime: 0.774,
  },
  {
    ...QUERY_BASE,
    id: 14,
    name: 'Rider Feedback Keywords',
    description: 'Terms riders used most in the last 30 days of station feedback cards',
    query: `SELECT term,
       count(*) AS mentions
FROM rider_feedback_terms
WHERE submitted_at >= today() - 30
GROUP BY term
ORDER BY mentions DESC
LIMIT 10;`,
    tags: ['feedback', 'stations'],
    visualizations: [
      { id: 55, type: 'WORD_CLOUD', name: 'Feedback Terms', description: '', options: WORD_CLOUD_OPTIONS, created_at: AUTHORED, updated_at: AUTHORED },
    ],
    latest_query_data_id: 114,
    runtime: 0.191,
  },
]

export const vizQueryResultsC: Record<number, MockQueryResult> = {
  // Query 11. One three-column edge list carrying both stages of the flow,
  // which is why a station is a target in the first six rows and a source in
  // the last five. Each station's inbound and outbound totals match, so no
  // node visibly leaks riders.
  111: {
    id: 111,
    query_hash: 'hash_111',
    query: 'SELECT access_mode AS source_node, station AS target_node...',
    data: {
      columns: [
        { name: 'source_node', friendly_name: 'From', type: 'string' },
        { name: 'target_node', friendly_name: 'To', type: 'string' },
        { name: 'trips', friendly_name: 'Trips', type: 'integer' },
      ],
      rows: [
        { source_node: 'Walk', target_node: 'Central Station', trips: 4200 },
        { source_node: 'Local Bus', target_node: 'Central Station', trips: 3100 },
        { source_node: 'Park and Ride', target_node: 'Central Station', trips: 1450 },
        { source_node: 'Bike Share', target_node: 'Central Station', trips: 620 },
        { source_node: 'Walk', target_node: 'Downtown Interchange', trips: 5300 },
        { source_node: 'Local Bus', target_node: 'Downtown Interchange', trips: 2400 },
        { source_node: 'Central Station', target_node: 'Line 1', trips: 5200 },
        { source_node: 'Central Station', target_node: 'Line 2', trips: 2600 },
        { source_node: 'Central Station', target_node: 'Line 3', trips: 1570 },
        { source_node: 'Downtown Interchange', target_node: 'Line 1', trips: 3300 },
        { source_node: 'Downtown Interchange', target_node: 'Line 4', trips: 4400 },
      ],
    },
    data_source_id: 1,
    runtime: 0.612,
    retrieved_at: AUTHORED,
  },
  // Query 12. Every country string is a verbatim `name` from
  // world-countries.geojson. A near miss ("Czech Republic", "Holland") joins to
  // nothing and the map degrades to "No regions matched the key column". A
  // different country set from the LA pack, deliberately, but the same length.
  112: {
    id: 112,
    query_hash: 'hash_112',
    query: 'SELECT origin_country AS country, count(*) AS shipments...',
    data: {
      columns: [
        { name: 'country', friendly_name: 'Country', type: 'string' },
        { name: 'shipments', friendly_name: 'Shipments', type: 'integer' },
      ],
      rows: [
        { country: 'Germany', shipments: 486 },
        { country: 'France', shipments: 212 },
        { country: 'Spain', shipments: 168 },
        { country: 'Italy', shipments: 141 },
        { country: 'Poland', shipments: 96 },
        { country: 'Sweden', shipments: 74 },
        { country: 'Czechia', shipments: 58 },
        { country: 'Japan', shipments: 41 },
        { country: 'Brazil', shipments: 33 },
        { country: 'Australia', shipments: 27 },
      ],
    },
    data_source_id: 1,
    runtime: 0.238,
    retrieved_at: AUTHORED,
  },
  // Query 13. sunburst-model detects Redash's edge-list shape from the column
  // names alone (sequence, stage, node and value all present), so those four
  // names are load-bearing. The value repeats on every row of a sequence
  // because the model reads the leaf size from the group's first row rather
  // than summing the group.
  113: {
    id: 113,
    query_hash: 'hash_113',
    query: 'SELECT path_id AS sequence, hop AS stage, stop_name AS node...',
    data: {
      columns: [
        { name: 'sequence', friendly_name: 'Path', type: 'string' },
        { name: 'stage', friendly_name: 'Stage', type: 'integer' },
        { name: 'node', friendly_name: 'Stop', type: 'string' },
        { name: 'value', friendly_name: 'Trips', type: 'integer' },
      ],
      rows: [
        { sequence: 'p1', stage: 1, node: 'Central Station', value: 1840 },
        { sequence: 'p1', stage: 2, node: 'Line 1', value: 1840 },
        { sequence: 'p1', stage: 3, node: 'North Terminal', value: 1840 },
        { sequence: 'p2', stage: 1, node: 'Central Station', value: 960 },
        { sequence: 'p2', stage: 2, node: 'Line 2', value: 960 },
        { sequence: 'p2', stage: 3, node: 'South Terminal', value: 960 },
        { sequence: 'p3', stage: 1, node: 'Downtown Interchange', value: 1420 },
        { sequence: 'p3', stage: 2, node: 'Line 4', value: 1420 },
        { sequence: 'p3', stage: 3, node: 'West Terminal', value: 1420 },
        { sequence: 'p4', stage: 1, node: 'Downtown Interchange', value: 1120 },
        { sequence: 'p4', stage: 2, node: 'Line 1', value: 1120 },
        { sequence: 'p4', stage: 3, node: 'East Terminal', value: 1120 },
      ],
    },
    data_source_id: 1,
    runtime: 0.774,
    retrieved_at: AUTHORED,
  },
  // Query 14. Single words, and the highest count is a short one, because the
  // model scales the top term to a 100px font and d3-cloud drops any word too
  // wide for its 480px canvas instead of shrinking it.
  114: {
    id: 114,
    query_hash: 'hash_114',
    query: 'SELECT term, count(*) AS mentions FROM rider_feedback_terms...',
    data: {
      columns: [
        { name: 'term', friendly_name: 'Term', type: 'string' },
        { name: 'mentions', friendly_name: 'Mentions', type: 'integer' },
      ],
      rows: [
        { term: 'clean', mentions: 214 },
        { term: 'crowded', mentions: 186 },
        { term: 'delay', mentions: 152 },
        { term: 'transfer', mentions: 131 },
        { term: 'seating', mentions: 118 },
        { term: 'safety', mentions: 97 },
        { term: 'signage', mentions: 84 },
        { term: 'wifi', mentions: 66 },
        { term: 'parking', mentions: 58 },
        { term: 'lighting', mentions: 40 },
      ],
    },
    data_source_id: 1,
    runtime: 0.191,
    retrieved_at: AUTHORED,
  },
}

export const vizGalleryWidgetsC: MockDashboardWidget[] = [
  {
    id: 52,
    dashboard_id: 5,
    visualization: { id: 52, query: { id: 11 }, type: 'SANKEY', name: 'Transfer Flows', description: '', options: SANKEY_OPTIONS },
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 53,
    dashboard_id: 5,
    visualization: { id: 53, query: { id: 12 }, type: 'CHOROPLETH', name: 'Shipments by Country', description: '', options: CHOROPLETH_OPTIONS },
    width: 1,
    options: { position: { col: 3, row: 0, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 54,
    dashboard_id: 5,
    visualization: { id: 54, query: { id: 13 }, type: 'SUNBURST_SEQUENCE', name: 'Journey Paths', description: '', options: SUNBURST_OPTIONS },
    width: 1,
    options: { position: { col: 0, row: 10, sizeX: 3, sizeY: 10 } },
  },
  {
    id: 55,
    dashboard_id: 5,
    visualization: { id: 55, query: { id: 14 }, type: 'WORD_CLOUD', name: 'Feedback Terms', description: '', options: WORD_CLOUD_OPTIONS },
    width: 1,
    options: { position: { col: 3, row: 10, sizeX: 3, sizeY: 10 } },
  },
]
