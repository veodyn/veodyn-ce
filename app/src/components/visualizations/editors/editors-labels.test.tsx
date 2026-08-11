import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const EDITOR_DIR = join(process.cwd(), 'src/components/visualizations/editors')

const files = readdirSync(EDITOR_DIR).filter(
  (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx')
)

describe('visualization editors label their controls', () => {
  it.each(files)('%s has no unassociated raw <label>', (file) => {
    const source = readFileSync(join(EDITOR_DIR, file), 'utf8')
    // No `s` (dotAll) flag needed: `[^>]` already matches newlines on its own,
    // dotAll only changes what `.` matches, and this pattern has no `.`. The
    // `s` flag requires targeting es2018+, which this project's tsconfig
    // (ES2017) does not, so `tsc --noEmit` fails on it.
    const rawLabels = [...source.matchAll(/<label\b([^>]*)>/g)].filter(
      ([, attrs]) => !attrs.includes('htmlFor')
    )
    expect(rawLabels.map((m) => m[0])).toEqual([])
  })
})
