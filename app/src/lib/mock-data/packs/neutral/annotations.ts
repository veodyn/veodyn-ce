import type { Annotation } from '@/types/annotation'
import { mockDashboards } from './dashboards'

// Timestamps mirror the LA pack: chosen to fall inside the data range of the
// dashboard's time-series widgets where possible (Ridership Trend on
// dashboard 1 covers roughly Feb 18 - Mar 19 2026; Temperature Chart on
// dashboard 3 covers Mar 17-18 2026).
export const mockAnnotations: Annotation[] = [
  {
    id: 1,
    dashboard_id: mockDashboards[0].id,
    widget_id: null,
    start: '2026-03-05T00:00:00Z',
    end: null,
    label: 'Line 6 extension opens to the public',
    source: 'manual',
    created_at: '2026-03-05T09:00:00Z',
  },
  {
    id: 2,
    dashboard_id: mockDashboards[0].id,
    widget_id: 1,
    start: '2026-03-10T00:00:00Z',
    end: '2026-03-12T00:00:00Z',
    label: 'Winter storm reduces ridership across the network',
    source: 'manual',
    created_at: '2026-03-12T18:00:00Z',
  },
  {
    id: 3,
    dashboard_id: mockDashboards[2].id,
    widget_id: null,
    start: '2026-03-17T18:00:00Z',
    end: null,
    label: 'Red flag warning issued for the region',
    source: 'manual',
    created_at: '2026-03-17T19:00:00Z',
  },
]
