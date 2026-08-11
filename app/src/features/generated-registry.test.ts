import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURES } from './generated-registry'

const ROOT = process.cwd()
const GENERATOR = join(ROOT, 'scripts/generate-feature-registry.mjs')
const GENERATED = join(ROOT, 'src/features/generated-registry.ts')
const FEATURES_DIR = join(ROOT, 'src/features')

/** What the generator produces right now, without writing anything. */
function generate(featuresDir?: string): string {
  const args = ['--stdout', ...(featuresDir ? ['--dir', featuresDir] : [])]
  return execFileSync('node', [GENERATOR, ...args], { encoding: 'utf8' })
}

/**
 * The package directories actually present under src/features/, found by
 * reading the filesystem directly rather than by calling the generator. The
 * adjacent "matches what the generator produces" test already compares the
 * committed file against the generator; asking the generator what a package
 * is here would just compare the generator to itself and could not catch a
 * package the generator itself fails to discover.
 */
function packageDirsOnDisk(): string[] {
  return readdirSync(FEATURES_DIR)
    .filter((name) => statSync(join(FEATURES_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(FEATURES_DIR, name, 'index.ts')))
    .sort()
}

describe('the generated feature registry', () => {
  // The file is checked in rather than gitignored, so `tsc --noEmit` and a
  // fresh clone both work with no build step. The cost of checking in
  // generated output is that it can go stale, and this is what stops that.
  it('matches what the generator produces from the packages on disk', () => {
    expect(readFileSync(GENERATED, 'utf8')).toBe(generate())
  })

  it('registers every package directory that exists', () => {
    expect(Object.keys(FEATURES).sort()).toEqual(packageDirsOnDisk())
  })

  // The public product's own shape. A generator that cannot emit an empty
  // registry would make the CE build impossible, and this is the case Task 6's
  // ratchet actually exercises: it points this same generator at a temp
  // location with the feature directories moved away.
  it('emits a valid empty registry when no feature is installed', (ctx) => {
    const empty = ctx.task.id // any unique name; a directory that does not exist
    const output = generate(join(ROOT, 'src/features/__nonexistent__', empty))
    expect(output).toContain('FEATURES: Record<string, FeatureDescriptor> = {}')
    // No package is imported. A type-only import of FeatureDescriptor itself
    // is fine and expected: it is erased at compile time, so it does not pull
    // any feature's code into the module graph, which is the thing this
    // assertion actually guards against.
    expect(output).not.toMatch(/import \{ descriptor/)
  })
})

// Regression coverage for the three ways this generator was found to be
// foolable. None of these were pinned by a test before, which is exactly how
// each one shipped with nothing red.
describe('the generator refuses what would silently corrupt the registry', () => {
  it('refuses a __proto__ package directory rather than letting the feature vanish from Object.keys()', () => {
    const dir = mkdtempSync(join(FEATURES_DIR, '__test_proto__'))
    try {
      mkdirSync(join(dir, '__proto__'))
      writeFileSync(
        join(dir, '__proto__', 'index.ts'),
        "export const descriptor = { id: '__proto__', nav: [], routes: [] }\n"
      )
      expect(() => generate(dir)).toThrow(/cannot be a package directory name/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a --dir outside src/features, because its emitted imports could not resolve from there', () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'feature-registry-outside-'))
    try {
      expect(() => generate(outsideDir)).toThrow(/must point inside/)
    } finally {
      rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('refuses --dir without --stdout, rather than overwriting the checked-in registry with an empty one', () => {
    // A real subdirectory of src/features passes the containment check, so
    // without the --stdout requirement this would run to completion and
    // write an empty registry over GENERATED, the exact failure this guards
    // against. Calling the generator directly here, not through generate(),
    // because generate() always adds --stdout.
    expect(() =>
      execFileSync('node', [GENERATOR, '--dir', join(FEATURES_DIR, 'reports')], { encoding: 'utf8' })
    ).toThrow(/--dir requires --stdout/)
    // The checked-in file must be untouched by the call above.
    expect(readFileSync(GENERATED, 'utf8')).toBe(generate())
  })
})
