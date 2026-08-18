// The half of the db-logo guard that can see the PNGs: every entry in the
// manifest has a matching file in app/public/db-logos/.
//
// The other half, node/tests/query_runner/test_db_logo_assets.py, checks the
// live query runner registry against the same manifest. Its container binds
// node/ only, so it cannot reach app/public/db-logos/ itself.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Four levels up from app/src/components/data-sources/ reaches the monorepo
// root (one deeper than internal-key-gate.test.ts, whose REPO_ROOT this mirrors).
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
    // An unreadable manifest would run every it.each below over zero cases and
    // read as green. A vacuity guard, not a pin on the count: the curated
    // shipping set is 45 entries, so the floor stays well under it.
    expect(types.length).toBeGreaterThan(30)
  })

  it.each(types)('%s has a matching PNG in public/db-logos', (type) => {
    expect(existsSync(resolve(LOGOS_DIR, `${type}.png`))).toBe(true)
  })
})
