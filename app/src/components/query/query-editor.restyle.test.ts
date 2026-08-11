import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'components/query/query-editor-page.tsx',
  'components/query/query-editor-header.tsx',
  'components/query/query-editor-sidebar.tsx',
  'components/query/query-editor-dialogs.tsx',
  'components/query/query-editor-results.tsx',
  'components/query/editor-controls.tsx',
  'components/query/schema-browser.tsx',
  'components/query/query-source-menu.tsx',
  'components/query/visualization-tabs.tsx',
  'components/query/query-result-table.tsx',
  'app/queries/[queryId]/page.tsx',
  'app/queries/[queryId]/source/page.tsx',
  'app/queries/new/page.tsx',
]

describe('query editor surface carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
