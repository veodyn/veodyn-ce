// The half of the db-logo guard that can see the PNGs.
//
// data-source-logo.tsx builds `/db-logos/${type}.png` for every data source
// type; it falls back to a generic icon on load failure, but a registered
// type with no matching file still shows that generic icon instead of its
// real logo.
//
// node/tests/query_runner/test_db_logo_assets.py asserts the live query
// runner registry against node/tests/query_runner/db_logo_manifest.txt.
// That test's own container is a bind mount of node/ only, so it cannot
// read app/public/db-logos/ directly (see that file's docstring for
// why). This half does the other side of the same check: every entry in the
// manifest has a matching PNG here. Together the two reproduce the original,
// single-process guard; each file names the other so a reader who finds only
// one of them knows the check is not weaker than it looks.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// This file lives at app/src/components/data-sources/, one directory
// deeper than internal-key-gate.test.ts (app/src/lib/), whose
// REPO_ROOT this mirrors: four levels up from here reaches the monorepo
// root, not three.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const MANIFEST_PATH = resolve(REPO_ROOT, 'node/tests/query_runner/db_logo_manifest.txt')
const LOGOS_DIR = resolve(REPO_ROOT, 'app/public/db-logos')

function manifestTypes(): string[] {
  if (!existsSync(MANIFEST_PATH)) return []
  return readFileSync(MANIFEST_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
}

describe('the db logo manifest against public/db-logos', () => {
  it('finds the manifest, so a move produces a loud failure', () => {
    expect(existsSync(MANIFEST_PATH)).toBe(true)
  })

  const types = manifestTypes()

  it('is not vacuously empty', () => {
    // A missing or unreadable manifest would make every it.each below pass
    // over zero cases; guard against that reading as green.
    //
    // The floor is a vacuity guard, not a pin on the count. It read 50 while
    // the node still registered every driver in its tree; the curation that
    // picked the shipping set takes the manifest to 45 entries, so a floor
    // above that would fail on the intended state rather than on a manifest
    // this test could not read.
    expect(types.length).toBeGreaterThan(30)
  })

  it.each(types)('%s has a matching PNG in public/db-logos', (type) => {
    expect(existsSync(resolve(LOGOS_DIR, `${type}.png`))).toBe(true)
  })
})
