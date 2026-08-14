import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/connect/feeds/page.tsx',
  'app/connect/feeds/[slug]/page.tsx',
  'app/connect/feeds/[slug]/edit/page.tsx',
  'app/connect/feeds/new/page.tsx',
  'components/published-feeds/administered-note.tsx',
  'components/published-feeds/serving-status.tsx',
  'components/published-feeds/findings-list.tsx',
  'components/published-feeds/attempt-history.tsx',
  'components/published-feeds/binding-summary.tsx',
  'components/published-feeds/query-picker.tsx',
  'components/published-feeds/column-map-editor.tsx',
  'components/published-feeds/feed-form.tsx',
  'components/published-feeds/feed-form-on-failure.tsx',
]

describe('the published feeds surface carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
