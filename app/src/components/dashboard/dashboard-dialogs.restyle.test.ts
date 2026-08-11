import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'components/dashboard/add-widget-dialog.tsx',
  'components/dashboard/textbox-dialog.tsx',
  'components/dashboard/share-dashboard-dialog.tsx',
  'components/dashboard/dashboard-filters.tsx',
  'components/parameters/parameters-bar.tsx',
  'components/parameters/query-based-dropdown.tsx',
  'components/dashboard/add-widget-search.tsx',
  'components/dashboard/add-widget-visualization.tsx',
  'components/dashboard/add-widget-param-mapping.tsx',
  'components/dashboard/add-widget-layout.ts',
]

describe('dashboard dialogs and parameters carry no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
