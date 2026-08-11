import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

// The full catalog guard: all 4 catalog components plus the 3 catalog pages.
const files = [
  'components/catalog/freshness-badge.tsx',
  'components/catalog/dataset-card.tsx',
  'components/catalog/hub-counter-row.tsx',
  'components/catalog/schema-table.tsx',
  'app/data/page.tsx',
  'app/data/dataset/[datasetId]/page.tsx',
  'app/data/[domain]/page.tsx',
]

describe('data catalog carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
