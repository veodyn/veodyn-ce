#!/usr/bin/env node
/**
 * Emit src/plugins/generated-registry.ts from the package directories present
 * under src/plugins/.
 *
 * The registry used to be hand-written, which meant installing a plugin was an
 * edit to a product file. A tenant pack would then have had to ship its own
 * copy of that file and overwrite it at image build, and every later edit to
 * the product's copy would diverge silently. Generating it instead makes
 * installing a package the act of putting its directory in place, so a pack
 * carries only its own code.
 *
 * Still a static import map, for the reason the old hand-written one gave: the
 * bundler has to see the import to include the code, and a name resolved at
 * runtime defers a typo to the first person who opens the type selector.
 *
 * Convention: every package's index.ts exports `register`.
 *
 * Runs automatically before `pnpm build` via the `prebuild` script in
 * package.json. That is a fail-closed guard for the overlay build, not a
 * convenience: without it, a pack that forgets (or mis-orders) `pnpm
 * gen:plugins` would build successfully against the stale, public-only
 * committed registry, silently shipping an image with no tenant plugins.
 */
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const toStdout = args.includes('--stdout')
const dirFlag = args.indexOf('--dir')
const PLUGINS_DIR = dirFlag === -1 ? join(ROOT, 'src/plugins') : args[dirFlag + 1]
const OUT = join(ROOT, 'src/plugins/generated-registry.ts')

/**
 * Does this directory contain a .ts or .tsx file at any depth?
 *
 * Used to tell apart a real package that shipped with the wrong entry
 * filename (this returns true, and the missing index.ts must fail loudly)
 * from an ordinary non-package directory such as this file's own output or
 * its tests (this returns false, and it is skipped quietly).
 */
function containsTsFile(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (containsTsFile(path)) return true
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      return true
    }
  }
  return false
}

/**
 * A directory name is safe to embed, unescaped, both as an import path
 * segment (`from './NAME'`) and as an object key (`'NAME': ...`). Anything
 * outside this set (a quote, a space, a slash) can break the generated
 * source rather than merely look odd, so it is rejected outright.
 */
function isSafeName(name) {
  return /^[A-Za-z0-9_.-]+$/.test(name)
}

/**
 * A package is a directory under src/plugins that has an index.ts.
 *
 * The index.ts check is not decoration: src/plugins also holds this file's
 * output and the registry's own tests, and a non-package directory would
 * otherwise be emitted as an import of nothing. But a directory that
 * contains TypeScript and still has no index.ts is not that case: it is a
 * package with the wrong entry filename (an `index.tsx` pack, say), and
 * silently dropping it would ship a build that reports success with the
 * tenant's plugins simply missing. That fails loud instead.
 *
 * Two directories whose names mangle to the same identifier (`my-plugin` and
 * `my.plugin`) would otherwise emit a duplicate `const` binding that only
 * TypeScript catches, long after the generator ran. Caught here instead.
 */
function packages(dir) {
  if (!existsSync(dir)) return []
  const names = readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort()

  const found = []
  for (const name of names) {
    const pkgDir = join(dir, name)
    if (!existsSync(join(pkgDir, 'index.ts'))) {
      if (containsTsFile(pkgDir)) {
        throw new Error(
          `src/plugins/${name} looks like a plugin package (it contains a .ts or .tsx file) ` +
            `but has no index.ts. Every package must export its registration from ` +
            `src/plugins/${name}/index.ts.`
        )
      }
      continue
    }
    if (!isSafeName(name)) {
      throw new Error(
        `src/plugins/${name} is not a valid package directory name: it must be usable both ` +
          `as an import path segment and as an object key without escaping. Rename the ` +
          `directory using only letters, digits, underscore, hyphen, and dot.`
      )
    }
    found.push(name)
  }

  const seenIdentifiers = new Map()
  for (const name of found) {
    const id = identifier(name)
    const priorName = seenIdentifiers.get(id)
    if (priorName) {
      throw new Error(
        `src/plugins/${priorName} and src/plugins/${name} both mangle to the identifier ` +
          `'${id}'. Rename one of the directories so their generated identifiers differ.`
      )
    }
    seenIdentifiers.set(id, name)
  }

  return found
}

function render(names) {
  const header = [
    '// GENERATED by scripts/generate-plugin-registry.mjs. Do not edit.',
    '//',
    '// Run `pnpm gen:plugins` after adding or removing a package directory',
    '// under src/plugins/. The checked-in copy is asserted against the',
    '// generator in generated-registry.test.ts, so a stale one fails the suite.',
    '',
  ]
  if (names.length === 0) {
    return [
      ...header,
      '/** Every plugin package installed in this build. The stock build installs none. */',
      'export const PLUGIN_PACKAGES: Record<string, () => void> = {}',
      '',
    ].join('\n')
  }
  return [
    ...header,
    ...names.map((name) => `import { register as ${identifier(name)} } from './${name}'`),
    '',
    '/** Every plugin package installed in this build, by directory name. */',
    'export const PLUGIN_PACKAGES: Record<string, () => void> = {',
    ...names.map((name) => `  '${name}': ${identifier(name)},`),
    '}',
    '',
  ].join('\n')
}

/** A directory name is not necessarily a legal identifier (`my-plugin`). */
function identifier(name) {
  return `register_${name.replace(/[^A-Za-z0-9_$]/g, '_')}`
}

try {
  const output = render(packages(PLUGINS_DIR))
  if (toStdout) process.stdout.write(output)
  else writeFileSync(OUT, output)
} catch (err) {
  console.error(`generate-plugin-registry: ${err.message}`)
  process.exit(1)
}
