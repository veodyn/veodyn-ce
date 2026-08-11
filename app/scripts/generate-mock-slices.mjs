// Emitting src/stores/generated-mock-slices.ts, split out of
// scripts/generate-feature-registry.mjs for file size only. That script is the
// entry point; this holds the scanning and rendering.
//
// WHY A GENERATED STATIC IMPORT MAP IS NOT A HOLE IN THE DESCRIPTOR BOUNDARY
//
// A FeatureDescriptor may only ever hold a DEFERRED import of its feature's
// code, because src/features/index.ts is reached from the server root layout
// through src/lib/theme-preference.ts: a static import there would put feature
// implementation on every route's pre-paint path. That rule is enforced by
// src/features/feature-boundary.test.ts and is not relaxed by anything here.
//
// The mock store cannot live inside it. `FeatureDescriptor.mockData` carries
// mock ROWS through a loader, but a slice carries ACTIONS (`addKpi`,
// `transitionReport`), and those have to exist on the object `create()` builds
// at module scope. There is no point at which a promise could be spread into
// it.
//
// So the descriptor names its slice module as a STRING, which is inert data the
// boundary guard has no quarrel with, and this generator turns that string into
// a real static import in a module that is NOT a descriptor and is NOT on the
// pre-paint path: src/stores/generated-mock-slices.ts is imported by
// src/stores/mock-data-store.ts and by nothing else. In a build with no feature
// packages it is EMPTY, which is the same fail-closed property
// src/features/generated-registry.ts already has, and `prebuild` regenerates
// both.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where a contributed slice module may live, and what its specifier may look
 * like.
 *
 * `@/stores/<name>` only, and deliberately not `src/features/<pkg>/...`. The
 * boundary guard scans EVERY file under a package directory, not just its
 * index.ts, so a slice moved in there would fail it the moment it imported
 * `@/types/kpi`. Task 2 hit exactly that. The slices stay in src/stores/ and
 * left this tree with the enterprise pack like any other enterprise module.
 *
 * Pinning the prefix also guarantees the emitted import resolves: every
 * specifier below is written into the generated file verbatim.
 */
const SPECIFIER = /^@\/stores\/[A-Za-z0-9_.-]+$/

/** A directory or specifier segment mangled into a legal JS identifier. */
function identifier(name) {
  return name.replace(/[^A-Za-z0-9_$]/g, '_')
}

/**
 * The `mockSlices` a package's descriptor declares, in the order it lists them.
 *
 * Read out of the SOURCE rather than by importing the descriptor, because this
 * is a plain node script and the descriptor is TypeScript. That makes the
 * accepted form narrow on purpose: a literal array of single-quoted strings and
 * nothing else. `mockSlices: SLICES` or `mockSlices: [...base]` cannot be
 * resolved by reading text, and silently emitting no slice for a feature that
 * declared one would put a build on screen with `addKpi` missing and nothing
 * red anywhere, so both fail loudly instead.
 *
 * The token appearing in a comment fails the same way. That is the same
 * fail-closed choice src/features/feature-boundary-scan.ts documents for import
 * specifiers written inside comments: a descriptor has no reason to write
 * `mockSlices:` in prose, and a stripper that understood comments but not
 * string literals would just move the hole one line down.
 */
export function declaredSlices(pkg, source) {
  const matches = [...source.matchAll(/\bmockSlices\s*:\s*\[([^\]]*)\]/g)]
  if (matches.length === 0) {
    if (/\bmockSlices\b/.test(source)) {
      throw new Error(
        `src/features/${pkg}/index.ts writes 'mockSlices' but not as a literal array of ` +
          `single-quoted module specifiers. This generator reads the descriptor's SOURCE, so ` +
          `an array built from a constant or a spread cannot be resolved, and emitting nothing ` +
          `for it would ship a mock store missing that feature's actions with nothing red.`
      )
    }
    return []
  }
  if (matches.length > 1) {
    throw new Error(
      `src/features/${pkg}/index.ts declares mockSlices ${matches.length} times. One descriptor ` +
        `contributes one list, and which of them wins would otherwise be decided by this regex.`
    )
  }

  const inner = matches[0][1]
  const parts = inner
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const specifiers = []
  for (const part of parts) {
    const quoted = /^'([^']*)'$/.exec(part)
    if (quoted === null) {
      throw new Error(
        `src/features/${pkg}/index.ts has ${JSON.stringify(part)} in its mockSlices array. ` +
          `Every entry must be a single-quoted module specifier written out in full.`
      )
    }
    specifiers.push(quoted[1])
  }
  return specifiers
}

/**
 * Every contributed slice in this build, package by package.
 *
 * `names` arrives sorted by package directory name and the order is emitted
 * unchanged, because the composition order is BEHAVIOUR: two slices declaring
 * the same key resolve to whichever is spread last, so a reordering is a silent
 * change. Within one package the descriptor's own order is kept, which is the
 * only order its author wrote down.
 */
export function sliceContributions(appRoot, featuresDir, names) {
  const found = []
  const seen = new Map()
  for (const pkg of names) {
    const source = readFileSync(join(featuresDir, pkg, 'index.ts'), 'utf8')
    const specifiers = declaredSlices(pkg, source)
    for (let index = 0; index < specifiers.length; index += 1) {
      const specifier = specifiers[index]
      if (!SPECIFIER.test(specifier)) {
        throw new Error(
          `src/features/${pkg}/index.ts declares the mock slice '${specifier}', which is not of ` +
            `the form '@/stores/<module>'. A contributed slice stays in src/stores/: the feature ` +
            `boundary guard scans every file under a package directory, so a slice living in one ` +
            `would fail it as soon as it imported its feature's types.`
        )
      }
      const modulePath = join(appRoot, 'src', specifier.slice('@/'.length) + '.ts')
      if (!existsSync(modulePath)) {
        throw new Error(
          `src/features/${pkg}/index.ts declares the mock slice '${specifier}', but ` +
            `${modulePath} does not exist. A specifier is a string here and nothing else would ` +
            `resolve it until the generated file failed to compile, a long way from the typo.`
        )
      }
      const priorPkg = seen.get(specifier)
      if (priorPkg !== undefined) {
        throw new Error(
          `src/features/${priorPkg}/index.ts and src/features/${pkg}/index.ts both declare the ` +
            `mock slice '${specifier}'. Composing it twice would run its initialiser twice and ` +
            `emit a duplicate import binding. One slice belongs to one feature.`
        )
      }
      seen.set(specifier, pkg)
      found.push({ pkg, index, specifier })
    }
  }
  return found
}

const HEADER = [
  '// GENERATED by scripts/generate-feature-registry.mjs. Do not edit.',
  '//',
  '// Run `pnpm gen:features` after adding or removing a package directory under',
  '// src/features/, or after changing a descriptor\'s `mockSlices`. The checked-in',
  '// copy is asserted against the generator in generated-mock-slices.test.ts, so a',
  '// stale one fails the suite.',
  '//',
  '// The mock store composes its slices synchronously, so an installed feature',
  "// cannot hand it one through a descriptor's deferred loader: a slice carries",
  '// ACTIONS, and those have to be on the object create() builds at module scope.',
  '// The descriptor names its slice module as an inert STRING instead, and this',
  '// file is where that string becomes a real static import. It is imported by',
  '// src/stores/mock-data-store.ts and by nothing else, so no feature code',
  '// reaches the pre-paint path through it, and in a build with no feature',
  '// packages it is empty. See scripts/generate-mock-slices.mjs for the argument',
  '// in full.',
  '//',
  '// ORDER IS BEHAVIOUR: slices are emitted by feature package name, then in the',
  '// order that descriptor lists them. Two slices declaring the same key resolve',
  '// to whichever is spread last, so this order is sorted rather than left to',
  '// however the packages happened to be found.',
  '',
  "import type { StateCreator } from 'zustand'",
  "import type { MockDataState } from './mock-data-store'",
]

const SLICES_DOC = [
  '/**',
  " * What the installed features add to the mock store's state.",
  ' *',
  ' * Intersected into MockDataState, so a build with no feature package has a',
  ' * store typed with exactly the community collections and actions in it and a',
  ' * read of `state.kpis` does not compile.',
  ' */',
]

export function renderMockSlices(contributions) {
  if (contributions.length === 0) {
    return [
      ...HEADER,
      '',
      ...SLICES_DOC,
      'export type ContributedSlices = Record<never, never>',
      '',
      '/** Nothing is installed, so nothing is contributed. */',
      'export const createContributedSlices: StateCreator<MockDataState, [], [], ContributedSlices> = () => ({})',
      '',
    ].join('\n')
  }

  const named = contributions.map((entry) => ({
    ...entry,
    create: `createSlice_${identifier(entry.pkg)}_${entry.index}`,
    state: `SliceState_${identifier(entry.pkg)}_${entry.index}`,
  }))

  return [
    ...HEADER,
    ...named.map(
      (entry) =>
        `import ${entry.create}, { type ContributedSliceState as ${entry.state} } from '${entry.specifier}'`
    ),
    '',
    ...SLICES_DOC,
    `export type ContributedSlices = ${named.map((entry) => entry.state).join(' & ')}`,
    '',
    "/** Every installed feature's mock slice, composed in the order above. */",
    'export const createContributedSlices: StateCreator<MockDataState, [], [], ContributedSlices> = (',
    '  set,',
    '  get,',
    '  store',
    ') => ({',
    ...named.map((entry) => `  ...${entry.create}(set, get, store),`),
    '})',
    '',
  ].join('\n')
}
