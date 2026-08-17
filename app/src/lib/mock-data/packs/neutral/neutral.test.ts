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
  mockFeeds,
  mockGroups,
  mockQueries,
  mockQueryResults,
  mockQuerySnippets,
  mockSchema,
  mockUsers,
} from './index'

// This file used to compare the neutral pack against the LA pack throughout
// (same ids, same top-level keys, same block types). The LA pack has since
// moved to a private repo, so every comparison below is now a literal
// expectation of what the neutral pack itself must contain, written out
// rather than derived: a change that quietly drops a fixture, a key, or a
// block type still fails here even though there is no second pack left to
// diff against. The cross-fixture wiring checks (does a widget's query
// resolve, does a report block's {{ref}} resolve) live in
// neutral.wiring.test.ts; this file is only about shape.
//
// The KPI and report fixtures are covered by ./kpis.test.ts and
// ./reports.test.ts rather than here. They are contributed by installed
// features (FeatureDescriptor.mockData), so a community build does not have
// them and this file must compile without naming them. No assertion moved
// away without moving into one of those two.
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

  // The de-branding checks that used to sit here now live in
  // neutral.debranding.test.ts. They guard publication safety, not the shape
  // of the pack, which is what the rest of this file is about.

  it('has the expected top-level fixture shape (array lengths and ids)', () => {
    expect(mockUsers.map((u) => u.id)).toEqual([1, 2, 3, 4, 5, 6])
    // 11-21 are one query per visualization type that had no fixture at all,
    // in viz-fixtures-c/d/e/f. Written out literally, not derived, so a
    // change that drops one of them still fails here.
    expect(mockQueries.map((q) => q.id)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ])
    // 4 is the archived one, so the Archive tab is walkable without a
    // backend. 5 is the visualization gallery, one widget per type that had
    // no fixture.
    expect(mockDashboards.map((d) => d.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('has the expected data source types, connector family included', () => {
    // Written out literally for the reason the rest of this file is. The
    // last two entries come from data-source-types.connectors.ts and reach
    // this array through a spread, so a split that dropped the spread would
    // otherwise leave every other check here green.
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
    // The two fields a form gets wrong silently: a required field that is
    // not marked required saves an empty data source, and a secret that is
    // not marked secret renders the password in clear text.
    const tmdd = mockDataSourceTypes.find((t) => t.type === 'tmdd')
    expect(tmdd?.configuration_schema.required).toEqual(['endpoint_url', 'organization_id'])
    expect(tmdd?.configuration_schema.secret).toEqual(['password'])
  })

  // The mock is only useful if the form it renders is the form production
  // renders, and the property SET is what the form walks. This entry
  // advertised that it mirrors TMDD.configuration_schema() and was missing
  // the four fields connector_base.build_configuration_schema appends to
  // every runner in the family, so a mock-backed screen showed a shorter
  // form than the real backend. Written out literally, and against the
  // ORDER array as well, because a field present in `properties` and absent
  // from `order` is a field the form never draws.
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

  it('has the expected feed fixture shape (top-level keys)', () => {
    expect(mockFeeds.length).toBeGreaterThan(0)
    expect(Object.keys(mockFeeds[0]).sort()).toEqual([
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
