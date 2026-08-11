import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/settings/page.tsx',
  'components/settings/auth-settings.tsx',
  'components/settings/feature-flags.tsx',
  'components/settings/format-settings.tsx',
]

describe('settings carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
