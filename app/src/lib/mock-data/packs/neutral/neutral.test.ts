import { describe, expect, it } from 'vitest'
import {
  mockAlerts,
  mockAnnotations,
  mockDashboards,
  mockDataSources,
  mockDataSourceTypes,
  mockDatasets,
  mockDestinations,
  mockDestinationTypes,
  mockDomainHubs,
  mockCaptures,
  mockGroups,
  mockQueries,
  mockQueryResults,
  mockQuerySnippets,
  mockSchema,
  mockUsers,
} from './index'

// Shape only, with literal expectations rather than derived ones, so a dropped
// fixture, key, or block type fails here. Cross-fixture wiring (widget queries,
// report {{ref}}s) lives in neutral.wiring.test.ts.
//
// KPI and report fixtures come from FeatureDescriptor.mockData, so a community
// build lacks them: they are covered by ./kpis.test.ts and ./reports.test.ts.
describe('neutral demo pack, shape', () => {
  it('has non-empty key fixture arrays', () => {
    expect(mockUsers.length).toBeGreaterThan(0)
    expect(mockQueries.length).toBeGreaterThan(0)
    expect(Object.keys(mockQueryResults).length).toBeGreaterThan(0)
    expect(mockDashboards.length).toBeGreaterThan(0)
    expect(mockDataSources.length).toBeGreaterThan(0)
    expect(mockDataSourceTypes.length).toBeGreaterThan(0)
    expect(mockAlerts.length).toBeGreaterThan(0)
    expect(mockGroups.length).toBeGreaterThan(0)
    expect(mockDestinations.length).toBeGreaterThan(0)
    expect(mockDestinationTypes.length).toBeGreaterThan(0)
    expect(mockQuerySnippets.length).toBeGreaterThan(0)
    expect(Object.keys(mockSchema).length).toBeGreaterThan(0)
    expect(mockDatasets.length).toBeGreaterThan(0)
    expect(mockDomainHubs.length).toBeGreaterThan(0)
    expect(mockAnnotations.length).toBeGreaterThan(0)
  })

  // De-branding checks (publication safety) live in
  // neutral.debranding.test.ts.

  it('has the expected top-level fixture shape (array lengths and ids)', () => {
    expect(mockUsers.map((u) => u.id)).toEqual([1, 2, 3, 4, 5, 6])
    // 11-21 are one query per visualization type that had no fixture at all,
    // in viz-fixtures-c/d/e/f.
    expect(mockQueries.map((q) => q.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ])
    // 4 is archived, so the Archive tab is walkable without a backend. 5 is
    // the visualization gallery, one widget per type that had no fixture.
    expect(mockDashboards.map((d) => d.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('has the expected data source types, connector family included', () => {
    // The last two entries reach this array from
    // data-source-types.connectors.ts through a spread, and a dropped spread
    // leaves every other check here green.
    expect(mockDataSourceTypes.map((t) => t.type)).toEqual([
      'pg',
      'mysql',
      'sqlite',
      'json',
      'google_spreadsheets',
      'bigquery',
      'redshift',
      'clickhouse',
      'mongodb',
      'prometheus',
      'ntcip_dms',
      'tmdd',
    ])
    // A required field not marked required saves an empty data source; a
    // secret not marked secret renders the password in clear text.
    const tmdd = mockDataSourceTypes.find((t) => t.type === 'tmdd')
    expect(tmdd?.configuration_schema.required).toEqual(['endpoint_url', 'organization_id'])
    expect(tmdd?.configuration_schema.secret).toEqual(['password'])
  })

  // The four fields connector_base.build_configuration_schema appends to every
  // runner in the family. Asserted against `order` too: a field in
  // `properties` but absent from `order` is one the form never draws.
  const COMMON = ['request_timeout', 'redis_url', 'enable_historical_capture', 'historical_retention_days']

  it.each([
    [
      'tmdd',
      [
        'endpoint_url',
        'username',
        'password',
        'organization_id',
        'tmdd_version',
        'soap_action',
        'message_type_id',
        'message_type_version',
        'verify_tls',
        'ca_bundle',
        'max_response_mb',
        'max_records',
        ...COMMON,
      ],
    ],
    [
      'ntcip_dms',
      ['community', 'snmp_version', 'default_devices', 'per_device_timeout', 'max_devices', ...COMMON],
    ],
  ])('mirrors the whole %s configuration schema, common fields included', (type, expected) => {
    const schema = mockDataSourceTypes.find((t) => t.type === type)?.configuration_schema
    expect(Object.keys(schema?.properties ?? {})).toEqual(expected)
    expect(schema?.order).toEqual(expected)
  })

  it('has the expected catalog fixture shape (dataset and domain hub keys)', () => {
    expect(mockDatasets.length).toBeGreaterThan(0)
    expect(mockDomainHubs.length).toBeGreaterThan(0)
    expect(Object.keys(mockDatasets[0]).sort()).toEqual([
      'coverage',
      'description',
      'domain',
      'freshness',
      'id',
      'name',
      'origin',
      'rowCount',
      'sampleQueryId',
      'schema',
      'sources',
      'tags',
      'writable',
    ])
    expect(Object.keys(mockDomainHubs[0]).sort()).toEqual([
      'counters',
      'dashboardIds',
      'datasetIds',
      'icon',
      'key',
      'label',
    ])
  })

  it('has the expected annotation fixture shape (ids and keys)', () => {
    expect(mockAnnotations.map((a) => a.id)).toEqual([1, 2, 3])
    expect(Object.keys(mockAnnotations[0]).sort()).toEqual([
      'created_at',
      'dashboard_id',
      'end',
      'id',
      'label',
      'source',
      'start',
      'widget_id',
    ])
  })

  it('has the expected capture fixture shape (top-level keys)', () => {
    expect(mockCaptures.length).toBeGreaterThan(0)
    expect(Object.keys(mockCaptures[0]).sort()).toEqual([
      'cadence',
      'datasetCount',
      'id',
      'lastReceivedAt',
      'name',
      'source',
      'status',
    ])
  })

})
