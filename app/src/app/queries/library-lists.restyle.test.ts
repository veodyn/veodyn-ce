import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/queries/page.tsx',
  'app/dashboards/page.tsx',
  'app/query-snippets/query-snippets-page.tsx',
  'components/shared/favorites-control.tsx',
]

describe('library list routes carry no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
