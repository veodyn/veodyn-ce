import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/destinations/page.tsx',
  'app/destinations/new/page.tsx',
  'app/destinations/[destinationId]/page.tsx',
]

describe('destinations domain carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
