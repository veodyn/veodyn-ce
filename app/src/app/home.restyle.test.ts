import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = ['components/home/notable-changes-strip.tsx', 'app/page.tsx']

describe('Home carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
