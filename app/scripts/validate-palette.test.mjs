// Spawns the actual CLI (not a reimplementation of its logic) so exit codes
// and terminal output are pinned against the real, packaged script rather
// than re-verified by eye each time someone touches it.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Resolved from the repo root (vitest's default cwd for this project), not
// from import.meta.url: under vitest's transform, that URL is not always a
// plain file:// URL, so new URL(...) resolution against it is unreliable.
const SCRIPT = path.resolve('scripts/validate-palette.mjs')

function run(arg) {
  const args = arg === undefined ? [SCRIPT] : [SCRIPT, arg]
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', ...args], {
    encoding: 'utf8',
    cwd: path.dirname(SCRIPT),
  })
}

describe('validate-palette CLI', () => {
  it('exits 0 and prints OK for both shipped defaults with no argument', () => {
    const result = run(undefined)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Palette (light, surface #FFFFFF): OK')
    expect(result.stdout).toContain('Palette (dark, surface #12161F): OK')
  })

  it('exits 1 and reports the failing checks for a known-bad palette', () => {
    const result = run('#41569E,#7A4E9E')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('FAILED')
    expect(result.stdout).toContain('[FAIL] CVD separation')
  })

  it('exits 1 with a readable message, not a stack trace, on a malformed hex', () => {
    const result = run('notahex')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not a #rgb or #rrggbb hex color')
    // A stack trace would include "at " frames and file:// source locations;
    // none of that belongs in front of a tenant pasting their own hex codes.
    expect(result.stderr).not.toContain(' at ')
    expect(result.stderr).not.toContain('file://')
  })

  it('exits 1 with a readable message on an empty-string argument, rather than falling back to the defaults', () => {
    const result = run('')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('No colors given')
    expect(result.stdout).not.toContain('Palette (light, surface #FFFFFF): OK')
  })

  // Finding 1: a light pair can pass every light check and still derive to a
  // dark pair that fails CVD and normal-vision separation. Before this fix,
  // custom input only ever validated the light column.
  it('checks the derived dark column too, and reports it separately from the light column', () => {
    const result = run('#6825AD,#2B64D0')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('Light column (as given)')
    expect(result.stdout).toContain('Palette (light, surface #FFFFFF): OK')
    expect(result.stdout).toContain('Dark column (derived from the light column)')
    expect(result.stdout).toContain('Palette (dark, surface #12161F): FAILED')
    expect(result.stdout).toContain('#7332BA')
  })

  // Finding 2: a one-color palette cycle-fills into 8 identical adjacent
  // slots at render time, which must fail rather than pass as "single slot,
  // no adjacent pair".
  it('fails a one-color custom palette instead of passing it as a single slot', () => {
    const result = run('#485EA7')
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('FAILED')
    expect(result.stdout).toContain('[FAIL] CVD separation')
  })

  // Finding 2: slots past 8 are never rendered, so a color that would fail on
  // its own must not affect the result when it lands past the 8th slot.
  it('ignores a 9th custom color rather than validating a slot nothing renders', () => {
    const result = run('#485EA7,#2B7E4E,#A37AC7,#3570A2,#89435E,#BF8A32,#1D9999,#B25630,#7A7A7A')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Palette (light, surface #FFFFFF): OK')
    expect(result.stdout).not.toContain('#7A7A7A')
  })
})
