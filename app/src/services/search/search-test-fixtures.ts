// The community objects the search-source suites federate over, in one place
// so the mock-mode suite and the tag-facet suite build the same shapes. Not a
// test file itself (the name avoids the `.test.` pattern vitest collects).
//
// makeKpi is deliberately not here: it moved to services/kpi/search-fixtures.ts
// with the KPI source, so this module (which a community build keeps) has no
// import of an enterprise type.
//
// Every factory takes its tags as an argument rather than hard-coding an empty
// array: the tag facet is the one dimension these suites vary per case.
import type { MockQuery, MockDashboard } from '@/lib/mock-data'
import type { Dataset } from '@/types/catalog'

export function makeQuery(id: number, name: string, tags: string[] = []): MockQuery {
  return {
    id,
    name,
    description: '',
    query: 'select 1',
    data_source_id: 1,
    schedule: null,
    tags,
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: { id: 1, name: 'A', email: 'a@example.com' },
    last_modified_by: { id: 1, name: 'A', email: 'a@example.com' },
    visualizations: [],
    latest_query_data_id: null,
    options: { parameters: [] },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    retrieved_at: '',
    runtime: 0,
    version: 1,
  }
}

export function makeDashboard(id: number, name: string, tags: string[] = []): MockDashboard {
  return {
    id,
    name,
    slug: `d-${id}`,
    tags,
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: true,
    user: { id: 1, name: 'A', email: 'a@example.com' },
    widgets: [],
    dashboard_filters_enabled: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    public_url: null,
    api_key: null,
    version: 1,
  }
}

export function makeDataset(id: string, name: string, tags: string[] = []): Dataset {
  return {
    id,
    name,
    description: '',
    domain: null,
    schema: [],
    freshness: { lastUpdatedAt: '2026-01-02T00:00:00Z', status: 'fresh' },
    coverage: { start: '2026-01-01T00:00:00Z', end: '2026-01-02T00:00:00Z' },
    rowCount: 0,
    sources: [],
    tags,
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
  }
}
