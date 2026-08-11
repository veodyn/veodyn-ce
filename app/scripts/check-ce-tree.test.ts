// Exercises the actual CLI (spawned, not reimplemented), the same method
// scripts/check-ce-build.test.ts used for the ratchet this guard replaced and
// scripts/validate-palette.test.mjs uses for the palette one. These pin the
// real script rather than a parallel copy of its logic.
//
// The cases that matter are the two directions. A guard whose subject has
// already been removed reports "clean" on every run in this repository, and a
// green run therefore proves nothing on its own about whether the guard works:
// deleting the body of check-ce-tree.mjs and printing "clean" would pass in CI
// forever. So every case below runs against a fixture tree with a planted path
// in it, or with the path deliberately absent, through the two CE_TREE_*
// overrides the script reads for exactly this purpose.
//
// The one case that runs against the REAL tree is last, and it is the one that
// would fail if an enterprise path came back.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installsNoFeaturePackages } from '@/features'
import { ENTERPRISE_PATHS } from './enterprise-paths.mjs'

const SCRIPT = join(process.cwd(), 'scripts/check-ce-tree.mjs')

let fixtureRoot: string | null = null

/** A tree holding exactly the given paths, each as a file with a parent directory. */
function makeFixture(present: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'ce-tree-fixture-'))
  for (const path of present) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), 'export const x = 1\n')
  }
  fixtureRoot = root
  return root
}

afterEach(() => {
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true })
  fixtureRoot = null
})

function runScript(root: string, paths: string[]) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, CE_TREE_APP_ROOT: root, CE_TREE_PATHS_JSON: JSON.stringify(paths) },
  })
}

describe('check-ce-tree', () => {
  it('passes when none of the listed paths is present', () => {
    const root = makeFixture(['src/lib/community.ts'])
    const result = runScript(root, ['src/lib/kpi-id.ts', 'src/components/kpi'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('clean')
    expect(result.stdout).toContain('2 enterprise paths')
  })

  it('fails and names every path that is present, and only those', () => {
    const root = makeFixture(['src/lib/kpi-id.ts', 'src/lib/community.ts'])
    const result = runScript(root, ['src/lib/kpi-id.ts', 'src/lib/report-id.ts'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/lib/kpi-id.ts')
    expect(result.stderr).not.toContain('src/lib/report-id.ts')
    expect(result.stderr).not.toContain('src/lib/community.ts')
  })

  it('catches a whole directory coming back, not only a file', () => {
    const root = mkdtempSync(join(tmpdir(), 'ce-tree-fixture-'))
    fixtureRoot = root
    mkdirSync(join(root, 'src/components/kpi'), { recursive: true })
    const result = runScript(root, ['src/components/kpi'])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('src/components/kpi')
  })

  // A list emptied by a bad merge, or by someone "fixing" a failure the quick
  // way, would otherwise make every future run green while checking nothing.
  // Exit 2 rather than 1 so it reads as "cannot check" and not as "found one".
  it('refuses an empty path list rather than reporting it as clean', () => {
    const root = makeFixture([])
    const result = runScript(root, [])

    expect(result.status).toBe(2)
    expect(result.stderr).toContain('would check nothing')
  })

  it('reads a real list with real entries in it', () => {
    expect(ENTERPRISE_PATHS.length).toBeGreaterThan(100)
    expect(ENTERPRISE_PATHS).toContain('src/features/kpis')
    expect(ENTERPRISE_PATHS).toContain('src/app/api/reports')
    // Every entry is a path under src/, never a URL and never absolute: the
    // route guard next door derives URL prefixes from the src/app/ ones and
    // would produce nonsense from anything else.
    expect(ENTERPRISE_PATHS.every((path) => path.startsWith('src/'))).toBe(true)
    expect(new Set(ENTERPRISE_PATHS).size).toBe(ENTERPRISE_PATHS.length)
  })

})

// The live one. Everything above proves the mechanism against fixture trees and
// is true of any build; this is the assertion the mechanism exists to make,
// against this checkout with no overrides.
//
// It is an invariant OF THE COMMUNITY REPOSITORY, not of check-ce-tree.mjs. It
// says the enterprise paths are absent from this tree, and a composed tree is
// by construction the one tree where every one of them is present, so the
// script is right to fail there. Skipped rather than weakened: an assertion
// rewritten to hold in both builds would say nothing in either, and this is the
// only thing standing between the pack's source and a community commit.
//
// The registry is what tells the two trees apart, and the skip prints its
// reason in the runner output where a path exclusion in CI would be invisible.
describe.skipIf(!installsNoFeaturePackages())('check-ce-tree against this checkout', () => {
  it('finds no enterprise path in this tree', () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' })
    expect(result.stderr, result.stderr).toBe('')
    expect(result.status).toBe(0)
  })
})
