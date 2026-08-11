import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/dashboards/[dashboardId]/page.tsx',
  'app/dashboards/[dashboardId]/dashboard-view-actions.tsx',
  'app/dashboards/dashboard-row-actions.tsx',
  'components/dashboard/dashboard-grid.tsx',
  'components/dashboard/visualization-widget.tsx',
  'components/dashboard/textbox-widget.tsx',
  'components/dashboard/expanded-widget-dialog.tsx',
  'components/dashboard/refresh-rate-picker.tsx',
]

describe('dashboard detail surface carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
