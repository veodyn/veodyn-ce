import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLUGIN_PACKAGES } from './generated-registry'

const ROOT = process.cwd()
const GENERATOR = join(ROOT, 'scripts/generate-plugin-registry.mjs')
const GENERATED = join(ROOT, 'src/plugins/generated-registry.ts')
const PLUGINS_DIR = join(ROOT, 'src/plugins')

/** What the generator produces right now, without writing anything. */
function generate(pluginsDir?: string): string {
  const args = ['--stdout', ...(pluginsDir ? ['--dir', pluginsDir] : [])]
  return execFileSync('node', [GENERATOR, ...args], { encoding: 'utf8' })
}

/**
 * The package directories actually present under src/plugins/, found by
 * reading the filesystem directly rather than by calling the generator. The
 * adjacent "matches what the generator produces" test already compares the
 * committed file against the generator; asking the generator what a package
 * is here would just compare the generator to itself and could not catch a
 * package the generator itself fails to discover.
 */
function packageDirsOnDisk(): string[] {
  return readdirSync(PLUGINS_DIR)
    .filter((name) => statSync(join(PLUGINS_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(PLUGINS_DIR, name, 'index.ts')))
    .sort()
}

describe('the generated plugin registry', () => {
  // The file is checked in rather than gitignored, so `tsc --noEmit` and a
  // fresh clone both work with no build step. The cost of checking in
  // generated output is that it can go stale, and this is what stops that.
  it('matches what the generator produces from the packages on disk', () => {
    expect(readFileSync(GENERATED, 'utf8')).toBe(generate())
  })

  it('registers every package directory that exists', () => {
    expect(Object.keys(PLUGIN_PACKAGES).sort()).toEqual(packageDirsOnDisk())
  })

  // The public product's own shape. A generator that cannot emit an empty
  // registry would make the OSS build impossible, and this is the case it is
  // least likely to be exercised on by accident.
  it('emits a valid empty registry when no package is installed', (ctx) => {
    const empty = ctx.task.id // any unique name; a directory that does not exist
    const output = generate(join(ROOT, 'src/plugins/__nonexistent__', empty))
    expect(output).toContain('PLUGIN_PACKAGES: Record<string, () => void> = {}')
    expect(output).not.toContain('import')
  })
})
