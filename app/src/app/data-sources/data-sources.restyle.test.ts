import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/data-sources/page.tsx',
  'app/data-sources/new/page.tsx',
  'app/data-sources/[dataSourceId]/page.tsx',
  'components/forms/dynamic-form.tsx',
]

describe('data sources domain carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
