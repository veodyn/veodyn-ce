// The mock-slice half of scripts/generate-feature-registry.mjs, pinned the way
// src/features/generated-registry.test.ts pins the registry half: the emitted
// file is checked in, so it can go stale, and this is what stops that.
//
// The generator reads a descriptor's SOURCE TEXT, so every way of writing
// `mockSlices` that cannot be resolved by reading text has to fail loudly:
// emitting nothing for a feature that declared a slice would ship a mock store
// missing that feature's actions with nothing red.
//
// Every fixture tree below is built in os.tmpdir(), NOT under src/features, and
// that is load-bearing: vitest runs test FILES in parallel, so a fixture package
// directory in src/features is visible to any suite scanning the real tree at the
// same moment, which made generated-registry.test.ts fail intermittently. The
// generator's --dir containment check exempts --stdout-slices for exactly this.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { declaredSlices, renderMockSlices, sliceContributions } from '../../scripts/generate-mock-slices.mjs'

const ROOT = process.cwd()
const GENERATOR = join(ROOT, 'scripts/generate-feature-registry.mjs')
const GENERATED = join(ROOT, 'src/stores/generated-mock-slices.ts')
const FEATURES_DIR = join(ROOT, 'src/features')

/** What the generator's CLI produces right now, without writing anything. */
function generate(featuresDir: string): string {
  return execFileSync('node', [GENERATOR, '--stdout-slices', '--dir', featuresDir], { encoding: 'utf8' })
}

/**
 * The package directories present under src/features, read off disk rather than
 * asked of the generator, which would compare it to itself.
 */
function packageDirsOnDisk(): string[] {
  return readdirSync(FEATURES_DIR)
    .filter((name) => statSync(join(FEATURES_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(FEATURES_DIR, name, 'index.ts')))
    .sort()
}

/** A throwaway features tree holding the given packages, outside src/features. */
function withPackages(packages: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'veodyn-mock-slices-'))
  try {
    for (const [pkg, index] of Object.entries(packages)) {
      mkdirSync(join(dir, pkg))
      writeFileSync(join(dir, pkg, 'index.ts'), index)
    }
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A minimal descriptor source declaring exactly these mock slices. */
function descriptorWith(specifiers: string[]): string {
  return `export const descriptor = { mockSlices: [${specifiers.map((s) => `'${s}'`).join(', ')}] }\n`
}

/**
 * A real module under src/stores, for fixtures that have to survive the
 * generator's existence check while running against the REAL app root.
 *
 * The CLI computes its own app root from the script's location and takes no
 * override, so a `--dir` fixture can point the features tree anywhere but the
 * slice specifier still has to resolve under `app/src/stores/`. A community
 * module standing in as a contributed slice: the generator only asks whether the
 * file is there, so nothing about feed-slice's own shape is asserted.
 */
const RESOLVABLE_SLICE = '@/stores/feed-slice'

/**
 * A throwaway APP root holding the given slice modules, so a case can name
 * several contributed slices without any of them existing in the real tree.
 * `sliceContributions` takes the app root explicitly; the CLI does not.
 */
function withStores(modules: string[], run: (appRoot: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'veodyn-mock-slices-root-'))
  try {
    mkdirSync(join(root, 'src/stores'), { recursive: true })
    for (const name of modules) writeFileSync(join(root, 'src/stores', `${name}.ts`), 'export default () => ({})\n')
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('the generated mock-slice module', () => {
  // Checked in rather than gitignored, so `tsc --noEmit` and a fresh clone both
  // work with no build step. The cost is that it can go stale.
  it('matches what the generator produces from the descriptors on disk', () => {
    const expected = renderMockSlices(sliceContributions(ROOT, FEATURES_DIR, packageDirsOnDisk()))
    expect(readFileSync(GENERATED, 'utf8')).toBe(expected)
  })

  // The case above compares the checked-in file to the two functions; this one
  // compares those functions to the CLI that `pnpm gen:features` (and so
  // `prebuild`) runs, so a generator that emitted the registry and quietly
  // skipped this file could not pass both.
  it('emits through the CLI exactly what the renderer produces', () => {
    withPackages({ kpis: descriptorWith([RESOLVABLE_SLICE]) }, (dir) => {
      expect(generate(dir)).toBe(renderMockSlices([{ pkg: 'kpis', index: 0, specifier: RESOLVABLE_SLICE }]))
    })
  })

  // The composition order IS behaviour: two slices declaring the same key resolve
  // to whichever is spread last. Asserted against the emitted text rather than
  // against the generator's own sort, so a reordering shows up as a diff.
  //
  // Against a FIXTURE, because the checked-in file is empty in a build that
  // installs no feature package. The fixture declares the packages in reverse
  // alphabetical order and gives the second-sorting one two slices, so both halves
  // of the rule (sort by package, then keep the descriptor's order) do work.
  it('emits every declared slice once, sorted by package and then by declaration order', () => {
    withStores(['zebra-slice', 'alpha-slice', 'alpha-extra-slice'], (appRoot) => {
      withPackages(
        {
          zebra: descriptorWith(['@/stores/zebra-slice']),
          alpha: descriptorWith(['@/stores/alpha-slice', '@/stores/alpha-extra-slice']),
        },
        (dir) => {
          const output = renderMockSlices(sliceContributions(appRoot, dir, ['alpha', 'zebra']))
          const imported = [
            ...output.matchAll(/^import \S+, \{ type ContributedSliceState as \S+ \} from '(.+)'$/gm),
          ].map((match) => match[1])
          const spread = [...output.matchAll(/^ {2}\.\.\.(createSlice_\w+)\(set, get, store\),$/gm)].map((m) => m[1])
          expect(imported).toEqual(['@/stores/alpha-slice', '@/stores/alpha-extra-slice', '@/stores/zebra-slice'])
          expect(spread).toEqual(['createSlice_alpha_0', 'createSlice_alpha_1', 'createSlice_zebra_0'])
        }
      )
    })
  })

  // The public product's own shape, and what the checked-in file holds here. A
  // module that could not be emitted empty would make a community build
  // impossible, so this goes through a fixture too: an overlay can replace the
  // checked-in copy, and this case still catches a generator that stopped
  // handling zero packages.
  it('emits a valid empty module when no feature is installed', () => {
    withPackages({}, (dir) => {
      const output = generate(dir)
      expect(output).toContain('export type ContributedSlices = Record<never, never>')
      // Nothing is imported from a feature's slice: the type-only imports of
      // StateCreator and MockDataState are erased and pull in no code.
      expect(output).not.toMatch(/^import createSlice_/m)
      expect(output).toContain(
        'createContributedSlices: StateCreator<MockDataState, [], [], ContributedSlices> = () => ({})'
      )
    })
  })
})

describe('the generator refuses what would silently corrupt the mock store', () => {
  it('refuses a mockSlices it cannot read as a literal array, rather than emitting no slice for it', () => {
    expect(() => declaredSlices('kpis', 'const d = { mockSlices: SLICE_MODULES }')).toThrow(/not as a literal array/)
    expect(() => declaredSlices('kpis', 'const d = { mockSlices: [...BASE] }')).toThrow(/must be a single-quoted/)
    expect(() => declaredSlices('kpis', 'const d = { mockSlices: [`@/stores/kpi-slice`] }')).toThrow(
      /must be a single-quoted/
    )
  })

  it('refuses two mockSlices declarations in one descriptor rather than letting a regex pick', () => {
    expect(() =>
      declaredSlices('kpis', "const d = { mockSlices: ['@/stores/a'] }\nconst e = { mockSlices: ['@/stores/b'] }")
    ).toThrow(/declares mockSlices 2 times/)
  })

  it('reads a well-formed declaration, and an absent one as no contribution', () => {
    expect(
      declaredSlices('reports', "mockSlices: ['@/stores/report-slice', '@/stores/report-refresh-slice'],")
    ).toEqual(['@/stores/report-slice', '@/stores/report-refresh-slice'])
    expect(declaredSlices('wall', "const d = { id: 'wall', nav: [], routes: [] }")).toEqual([])
  })

  it('refuses a slice that does not live in src/stores, because the boundary guard scans package directories', () => {
    withPackages({ kpis: descriptorWith(['../kpis/kpi-slice']) }, (dir) => {
      expect(() => sliceContributions(ROOT, dir, ['kpis'])).toThrow(/not of the form '@\/stores\/<module>'/)
    })
  })

  it('refuses a specifier naming a module that does not exist, rather than deferring the typo to tsc', () => {
    withPackages({ kpis: descriptorWith(['@/stores/kpi-slize']) }, (dir) => {
      expect(() => sliceContributions(ROOT, dir, ['kpis'])).toThrow(/does not exist/)
    })
  })

  it('refuses two features claiming one slice, which would compose it twice', () => {
    withStores(['shared-slice'], (appRoot) => {
      withPackages(
        { kpis: descriptorWith(['@/stores/shared-slice']), reports: descriptorWith(['@/stores/shared-slice']) },
        (dir) => {
          expect(() => sliceContributions(appRoot, dir, ['kpis', 'reports'])).toThrow(/both declare the mock slice/)
        }
      )
    })
  })

  // A refusal the CLI has to carry out of the helper as a non-zero exit, not
  // just one the helper knows how to throw.
  it('exits non-zero and names the package when a descriptor is refused', () => {
    withPackages({ kpis: descriptorWith(['@/stores/kpi-slize']) }, (dir) => {
      expect(() => generate(dir)).toThrow(/src\/features\/kpis\/index\.ts declares the mock slice/)
    })
  })

  // A renderer that dropped a contribution, or spread one it never imported, would
  // produce a file that compiled in the build that HAS the feature and failed only
  // in the one that does not.
  it('imports exactly what it spreads', () => {
    const output = renderMockSlices([
      { pkg: 'my-feature', index: 0, specifier: '@/stores/a-slice' },
      { pkg: 'my-feature', index: 1, specifier: '@/stores/b-slice' },
    ])
    expect(output).toContain(
      "import createSlice_my_feature_0, { type ContributedSliceState as SliceState_my_feature_0 } from '@/stores/a-slice'"
    )
    expect(output).toContain('...createSlice_my_feature_1(set, get, store),')
    expect(output).toContain('export type ContributedSlices = SliceState_my_feature_0 & SliceState_my_feature_1')
  })
})
