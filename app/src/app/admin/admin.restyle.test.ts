import { readdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

// Found rather than listed. This was a hand-written list of three pages, which
// meant a fourth admin page could land beside them with no restyle check at
// all: exactly what happened when the plugins page arrived. A list is a thing
// somebody forgets to extend, so the directory is the list. Same reasoning as
// the plugin import boundary test in src/plugins/plugin-boundary.test.ts.
const ADMIN = join(process.cwd(), 'src/app/admin')

const files = readdirSync(ADMIN, { recursive: true })
  .map(String)
  .filter((rel) => rel.endsWith('page.tsx'))
  .map((rel) => `app/admin/${rel.split(sep).join('/')}`)
  .sort()

describe('admin surfaces carry no Redash-era chrome', () => {
  // A walk that matches nothing would make the it.each below vacuous, which is
  // the shape of the bug the walk replaced.
  it('finds every admin page', () => {
    expect(files.length).toBeGreaterThanOrEqual(4)
    expect(files).toEqual(expect.arrayContaining(['app/admin/plugins/page.tsx']))
  })

  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
