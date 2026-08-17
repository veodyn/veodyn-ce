// Fixtures shared by slots.test.tsx (the single-contributor mechanism) and
// slots-multi.test.tsx (the multi-contributor one).
//
// Split out when the two suites together crossed the file-size limit, along
// the same single/multi seam the mechanism itself is split on. What is here is
// only what both files need: a descriptor with nothing on it but slots, and
// the non-empty prop values the slot tables have to supply.
import type { FeatureDescriptor, SlotContributions } from './types'
import type { MockDashboard } from '@/lib/mock-data'
import type { Dataset, HubCounter } from '@/types/catalog'

export function featureWith(id: string, slots: SlotContributions): FeatureDescriptor {
  return { id, nav: [], routes: [], slots }
}

export const COUNTER: HubCounter = {
  label: 'On-time performance',
  value: 82,
  unit: '%',
  kpiId: 'otp',
}

export const DATASET: Dataset = {
  id: 'restrooms',
  name: 'Restrooms',
  description: 'Public restroom locations.',
  domain: null,
  schema: [],
  freshness: { lastUpdatedAt: '2026-07-20T00:00:00Z', status: 'fresh' },
  coverage: { start: '2026-01-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
  rowCount: 0,
  sources: [],
  tags: [],
  sampleQueryId: null,
  origin: 'contributed',
  writable: true,
}

export const DASHBOARD: MockDashboard = {
  id: 1,
  name: 'Transit Overview',
  slug: 'transit-overview',
  tags: [],
  is_archived: false,
  is_draft: false,
  is_favorite: false,
  can_edit: true,
  user: { id: 1, name: 'Jane Analyst', email: 'jane@example.com' },
  widgets: [],
  dashboard_filters_enabled: false,
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z',
  public_url: null,
  api_key: null,
}
