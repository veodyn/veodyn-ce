import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'components/query/schedule-dialog.tsx',
  'components/query/embed-dialog.tsx',
  'components/query/api-key-dialog.tsx',
  'components/query/add-to-dashboard-dialog.tsx',
  'components/query/permissions-editor-dialog.tsx',
  'components/visualizations/edit-visualization-dialog.tsx',
  'components/visualizations/editors/chart-editor.tsx',
  'components/visualizations/editors/box-plot-editor.tsx',
  'components/visualizations/editors/counter-editor.tsx',
  'components/visualizations/editors/funnel-editor.tsx',
  'components/visualizations/editors/heatmap-editor.tsx',
  'components/visualizations/editors/map-editor.tsx',
  'components/visualizations/editors/pivot-editor.tsx',
  'components/visualizations/editors/sankey-editor.tsx',
  'components/visualizations/editors/table-editor.tsx',
  'components/visualizations/editors/details-editor.tsx',
]

describe('query and viz-editor dialogs carry no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
