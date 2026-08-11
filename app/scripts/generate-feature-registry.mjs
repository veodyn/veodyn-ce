#!/usr/bin/env node
/**
 * Emit src/features/generated-registry.ts, and src/stores/generated-mock-slices.ts,
 * from the package directories present under src/features/.
 *
 * Two files, one generator, because both answer the same question ("which
 * packages does this build contain") and a build that regenerated one without
 * the other would be inconsistent in exactly the way the registry exists to
 * prevent. The mock-slice half lives in scripts/generate-mock-slices.mjs, split
 * out for file size only; read its header for why a GENERATED static import of
 * feature code is legitimate where a descriptor-held one is not.
 *
 * A sibling of scripts/generate-plugin-registry.mjs, same reasoning: the set
 * of features a build contains becomes the act of putting a directory in
 * place under src/features/, not an edit to a hand-maintained list that a
 * pack overlay would have to fork and keep in sync.
 *
 * Still a static import map, for the reason the plugin one gives: the bundler
 * has to see the import to include the code, and a name resolved at runtime
 * defers a typo to whoever first reads the registry.
 *
 * Convention: every package's index.ts exports `descriptor`, a
 * `FeatureDescriptor` object. Unlike the plugin registry, descriptors carry no
 * function: they are inert data, asserted by the boundary guard.
 *
 * Runs automatically before `pnpm build` via the `prebuild` script in
 * package.json, alongside `pnpm gen:plugins`. That is a fail-closed guard for
 * a CE build: without it, a build that removed the feature directories but
 * forgot to regenerate would ship the stale, feature-populated registry
 * against code that no longer exists.
 */
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderMockSlices, sliceContributions } from './generate-mock-slices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
// Two stdout modes rather than one, so the existing `--stdout` contract (print
// the registry, byte for byte what the checked-in file holds) is unchanged and
// the mock-slice module gets a channel of its own for its own test.
const toStdout = args.includes('--stdout')
const slicesToStdout = args.includes('--stdout-slices')
const anyStdout = toStdout || slicesToStdout
const dirFlag = args.indexOf('--dir')
const DEFAULT_FEATURES_DIR = join(ROOT, 'src/features')
const FEATURES_DIR = dirFlag === -1 ? DEFAULT_FEATURES_DIR : resolve(args[dirFlag + 1])
const OUT = join(ROOT, 'src/features/generated-registry.ts')
const SLICES_OUT = join(ROOT, 'src/stores/generated-mock-slices.ts')

// --dir exists only for the tests, and they do not need to write the real
// file: they read --stdout instead. Without
// this, `--dir src/features/reports` (a real SUBDIRECTORY of src/features,
// so the containment check below allows it) writes an empty registry over
// the checked-in one, because packages() finds no index.ts one level down
// from a package directory. Refusing to run without --stdout closes that,
// rather than trying to enumerate every --dir value that would produce a
// wrong-but-plausible registry.
if (dirFlag !== -1 && !anyStdout) {
  console.error(
    '--dir requires --stdout: --dir exists only for tests, which read stdout and ' +
      'never need to overwrite the checked-in registry, and running it without ' +
      '--stdout would silently replace src/features/generated-registry.ts with ' +
      'whatever --dir points at.'
  )
  process.exit(1)
}

// --dir may only point INSIDE src/features when the REGISTRY is what is being
// emitted. Every import that file holds is written relative to
// src/features/generated-registry.ts, so a directory anywhere else produces a
// registry whose imports cannot resolve: aimed at src/plugins it happily emits
// `from './example'` for a package that does not exist under src/features. The
// plugin generator this one mirrors accepts it.
//
// --stdout-slices is exempt, and not as a convenience. The mock-slice module
// imports `@/stores/...` specifiers written out in full by the descriptor, so
// nothing it emits is relative to where the packages were read from and the
// argument above simply does not apply to it. The exemption is what lets its
// suite build fixture package trees in os.tmpdir() instead of inside
// src/features, where they would be seen by a concurrently running suite
// scanning the real tree and fail it.
if (
  dirFlag !== -1 &&
  !slicesToStdout &&
  FEATURES_DIR !== DEFAULT_FEATURES_DIR &&
  !FEATURES_DIR.startsWith(DEFAULT_FEATURES_DIR + sep)
) {
  console.error(
    `--dir must point inside ${DEFAULT_FEATURES_DIR}, because the imports this ` +
      `script emits are relative to src/features/generated-registry.ts and would ` +
      `not resolve from anywhere else. Got: ${FEATURES_DIR}`
  )
  process.exit(1)
}

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
 * Object keys that are legal directory names and legal in an object literal,
 * but do not behave as data there.
 *
 * `{'__proto__': descriptor}` sets the object's PROTOTYPE instead of creating
 * an own property, so the feature vanishes from Object.keys() while the
 * generated module still compiles and the build still succeeds. That is the
 * worst available failure: a feature silently absent from the registry with
 * nothing red anywhere. A cross-model review of this generator found it, and
 * the plugin generator this one mirrors still has it.
 */
const UNSAFE_KEYS = new Set(['__proto__'])

/**
 * A directory name is safe to embed, unescaped, both as an import path
 * segment (`from './NAME'`) and as an object key (`'NAME': ...`). Anything
 * outside this set (a quote, a space, a slash) can break the generated
 * source rather than merely look odd, so it is rejected outright, as is any
 * name that would not survive being used as a key.
 */
function isSafeName(name) {
  return /^[A-Za-z0-9_.-]+$/.test(name) && !UNSAFE_KEYS.has(name)
}

/**
 * A package is a directory under src/features that has an index.ts.
 *
 * The index.ts check is not decoration: src/features also holds this file's
 * own output, the shared types module and the registry's tests, and a
 * non-package directory would otherwise be emitted as an import of nothing.
 * But a directory that contains TypeScript and still has no index.ts is not
 * that case: it is a package with the wrong entry filename, and silently
 * dropping it would ship a build that reports success with the feature
 * simply missing. That fails loud instead.
 *
 * Two directories whose names mangle to the same identifier (`my-feature` and
 * `my.feature`) would otherwise emit a duplicate `const` binding that only
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
          `src/features/${name} looks like a feature package (it contains a .ts or .tsx file) ` +
            `but has no index.ts. Every package must export its descriptor from ` +
            `src/features/${name}/index.ts.`
        )
      }
      continue
    }
    if (UNSAFE_KEYS.has(name)) {
      throw new Error(
        `src/features/${name} cannot be a package directory name. It is a legal directory ` +
          `name and a legal object key, but not a DATA one: '${name}' in an object literal ` +
          `sets the prototype instead of an own property, so this feature would vanish from ` +
          `the registry with the build still green. Rename the directory.`
      )
    }
    if (!isSafeName(name)) {
      throw new Error(
        `src/features/${name} is not a valid package directory name: it must be usable both ` +
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
        `src/features/${priorName} and src/features/${name} both mangle to the identifier ` +
          `'${id}'. Rename one of the directories so their generated identifiers differ.`
      )
    }
    seenIdentifiers.set(id, name)
  }

  return found
}

function render(names) {
  const header = [
    '// GENERATED by scripts/generate-feature-registry.mjs. Do not edit.',
    '//',
    '// Run `pnpm gen:features` after adding or removing a package directory',
    '// under src/features/. The checked-in copy is asserted against the',
    '// generator in generated-registry.test.ts, so a stale one fails the suite.',
    '',
    "import type { FeatureDescriptor } from './types'",
    '',
  ]
  if (names.length === 0) {
    return [
      ...header,
      '/** Every feature package installed in this build. The stock build installs none. */',
      'export const FEATURES: Record<string, FeatureDescriptor> = {}',
      '',
    ].join('\n')
  }
  return [
    ...header,
    ...names.map((name) => `import { descriptor as ${identifier(name)} } from './${name}'`),
    '',
    '/** Every feature package installed in this build, by directory name. */',
    'export const FEATURES: Record<string, FeatureDescriptor> = {',
    ...names.map((name) => `  '${name}': ${identifier(name)},`),
    '}',
    '',
  ].join('\n')
}

/** A directory name is not necessarily a legal identifier (`my-feature`). */
function identifier(name) {
  return `descriptor_${name.replace(/[^A-Za-z0-9_$]/g, '_')}`
}

try {
  const names = packages(FEATURES_DIR)
  const registry = render(names)
  // Both are rendered before either is written, so a package that fails the
  // mock-slice guards leaves the checked-in registry alone rather than half
  // updating the pair.
  const slices = renderMockSlices(sliceContributions(ROOT, FEATURES_DIR, names))
  if (slicesToStdout) process.stdout.write(slices)
  else if (toStdout) process.stdout.write(registry)
  else {
    writeFileSync(OUT, registry)
    writeFileSync(SLICES_OUT, slices)
  }
} catch (err) {
  console.error(`generate-feature-registry: ${err.message}`)
  process.exit(1)
}
