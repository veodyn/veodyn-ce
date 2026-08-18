// The import and export boundary every feature descriptor has to stay inside.
// Mirrors src/plugins/plugin-boundary.test.ts and the git-tracked package guard
// in src/plugins/index.test.ts. See
// docs/superpowers/plans/2026-08-07-ee-1-registry-seam.md.
//
// A descriptor is data the shared surfaces (sidebar, search, route guards) read
// without ever pulling in a feature's implementation. That holds only while a
// descriptor imports nothing from the feature it describes and exports nothing
// but plain data: src/lib/theme-preference.ts is reached from the server root
// layout, so an exported component or hook would pull feature implementation
// into every route's pre-paint theme path.
//
// The scanning and resolution mechanics live in feature-boundary-scan.ts, split
// out for file size only.
import { execFileSync } from 'node:child_process'
import { sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FEATURES } from './generated-registry'
import { FILES, PACKAGES, code, importsIn, offendersIn } from './feature-boundary-scan'

// One case over every file rather than `it.each(FILES)`, because FILES is EMPTY
// in a build that installs no feature package and `it.each([])` is a collection
// error ("No test found in suite"), not a passing zero. The assertion still
// names the offending file and specifier. It is live in any composed build and
// vacuous here, where there is nothing to scan.
describe('feature descriptor import boundary', () => {
  it('every descriptor file imports only lucide-react or a path inside its own package (or ../types)', () => {
    const offences = FILES.flatMap((file) =>
      offendersIn(file, code(file)).map((specifier) => `${file}: ${specifier}`)
    )
    expect(offences).toEqual([])
  })
})

/**
 * A descriptor module's exports are exactly one, named `descriptor`, and it
 * is a plain data object.
 *
 * `typeof export !== 'function'` is not this invariant: `React.memo(...)` and
 * `React.forwardRef(...)` are both typeof 'object', not 'function', and so is
 * `export default { Page: () => null }`, whose export name a value-only check
 * never notices. Nor can this assert "no functions anywhere in the object":
 * FeatureNavRow.icon is a lucide component, legitimately.
 *
 * What separates a descriptor from a wrapper is the `$$typeof` symbol React
 * stamps onto every one of its special types (element, memo, forwardRef, lazy,
 * context, provider). A genuine descriptor never carries one.
 */
function isPlainDataObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  if ('$$typeof' in value) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Looped rather than `it.each(PACKAGES)`, for the reason given above the import
// boundary: an empty PACKAGES makes `it.each` a collection error.
describe('feature descriptor export shape', () => {
  it('every package exports exactly one binding, named descriptor, and it is a plain object', async () => {
    for (const pkg of PACKAGES) {
      const featureModule = (await import(`./${pkg}/index.ts`)) as Record<string, unknown>
      expect(Object.keys(featureModule), `${pkg}/index.ts must export exactly one binding, named descriptor`).toEqual(
        ['descriptor']
      )
      expect(
        isPlainDataObject(featureModule.descriptor),
        `${pkg}'s descriptor export must be a plain data object, not a React component wrapper or other special value`
      ).toBe(true)
    }
  })

  // With no package installed nothing exercises isPlainDataObject. These four
  // inputs do, and the three rejections are the ones a bare
  // `typeof !== 'function'` check would let through.
  it('tells a descriptor from a React wrapper and from a class instance', () => {
    expect(isPlainDataObject({ id: 'alpha', nav: [], routes: [] })).toBe(true)
    expect(isPlainDataObject({ $$typeof: Symbol.for('react.memo'), type: () => null })).toBe(false)
    expect(isPlainDataObject(new (class Descriptor {})())).toBe(false)
    expect(isPlainDataObject([{ id: 'alpha' }])).toBe(false)
  })
})

// A guard that matches nothing is a guard that cannot fail, and this repo has
// been bitten by that five times. Everything below pins that this one sees real
// code and covers every package.
describe('feature descriptor import boundary, self-checks', () => {
  // An exact equality, not a `toContain`: every feature package here is a
  // product package, unlike the plugin guard's `example`, which shares its
  // directory with confidential per-customer ones. A package on disk but absent
  // from the generated registry (or the reverse) means the generator and this
  // guard have drifted apart.
  it('scans exactly the packages the registry installed', () => {
    expect(PACKAGES).toEqual(Object.keys(FEATURES).sort())
  })

  // A package present that contributes no files leaves its own boundary
  // unchecked while the suite stays green. Stated as an implication rather than
  // `FILES.length > 0`, which is FALSE in a build with no feature package: zero
  // packages contributing zero files is correct there, while one package
  // contributing zero files is a bug in any build.
  it('every package present contributes source files to the guard', () => {
    const silent = PACKAGES.filter((pkg) => FILES.filter((f) => f.startsWith(`${pkg}${sep}`)).length === 0)
    expect(silent, 'a package the guard scans no files for is a package with no boundary').toEqual([])
  })

  it('reads an import as an import and an identifier as an identifier', () => {
    expect(importsIn("import { Bell } from 'lucide-react'")).toEqual(['lucide-react'])
    expect(importsIn("import type { FeatureDescriptor } from '../types'")).toEqual(['../types'])
    expect(importsIn("const C = ['effective_from', 'x']")).toEqual([])
  })

  // Proves code() reads a real file off disk rather than a string a test made
  // up. The specimen is types.ts, the one module under src/features every build
  // has: it is not itself scanned (it is not inside a package directory), and
  // it holds a mix of bare and aliased specifiers.
  it('sees the imports it is checking, read off a real file', () => {
    expect(importsIn(code('types.ts'))).toEqual(expect.arrayContaining(['react', 'lucide-react', '@/types/catalog']))
  })

  it('allows lucide-react and a relative path resolving inside the package, and rejects everything else, naming the offender', () => {
    const offending = [
      "import { useKpis } from '@/hooks/use-kpis'",
      "import { KpiCard } from '@/components/kpi/kpi-card'",
      "import React from 'react'",
    ].join('\n')
    expect(offendersIn('reports/index.ts', offending)).toEqual([
      '@/hooks/use-kpis',
      '@/components/kpi/kpi-card',
      'react',
    ])
    // The positive control: a well-formed descriptor imports its icons and the
    // shared types module and nothing else.
    expect(
      offendersIn('reports/index.ts', "import { Bell } from 'lucide-react'\nimport type { X } from '../types'")
    ).toEqual([])
  })

  // A specifier that starts with `../`, so a prefix-only check would call it
  // allowed, but resolves outside the importing file's own package directory.
  it('rejects a relative import that climbs out of its own package directory, even though it starts with ../', () => {
    expect(offendersIn('reports/index.ts', "import { useKpis } from '../../../hooks/use-kpis'")).toEqual([
      '../../../hooks/use-kpis',
    ])
    // A relative import that stays inside the same package is unaffected.
    expect(offendersIn('reports/index.ts', "import { helper } from './helper'")).toEqual([])
    // A sibling package is still outside, even one hop away.
    expect(offendersIn('reports/index.ts', "import { descriptor } from '../kpis'")).toEqual(['../kpis'])
  })

  it('fails any dynamic import() written with a template literal', () => {
    expect(offendersIn('reports/index.ts', 'const load = () => import(`../../../hooks/use-kpis`)')).toEqual([
      'import(`../../../hooks/use-kpis`)',
    ])
  })

  // The CE/EE split's seam: a descriptor reaches its feature's search source,
  // slot and proposal renderers through `import('...')`, and the SAME specifier
  // written as a static import must still fail. If both lines below ever agree,
  // the pre-paint invariant is gone.
  it('allows a deferred import of a specifier it refuses to import statically', () => {
    const specifier = '@/services/kpi/client'

    expect(offendersIn('kpis/index.ts', `const load = () => import('${specifier}')`)).toEqual([])
    expect(offendersIn('kpis/index.ts', `import { listKpis } from '${specifier}'`)).toEqual([specifier])
  })

  // require() is a call too, and it is NOT deferred: it resolves and runs at
  // module scope, which is the thing the guard exists to stop. Without this,
  // the paren check above would read it as deferred and wave it through.
  it('treats require() as static even though it is written as a call', () => {
    expect(offendersIn('kpis/index.ts', "const c = require('@/services/kpi/client')")).toEqual([
      '@/services/kpi/client',
    ])
  })

  // Proves the fail-closed choice above: comments are not stripped, so an
  // import specifier written inside one still fails the guard, where the plugin
  // guard's comment-aware stripper would let it through.
  it('fails a disallowed import even when it is written inside a comment', () => {
    expect(offendersIn('reports/index.ts', "// import { useKpis } from '@/hooks/use-kpis'")).toEqual([
      '@/hooks/use-kpis',
    ])
  })
})

// Stops a future EE feature directory from being committed into the public tree
// unnoticed. Mirrors src/plugins/index.test.ts's 'tracked plugin packages'
// guard: `git ls-files` rather than a filesystem read, so a package present on
// disk but never committed (an overlay build copies its own directories in at
// image-build time) does not fail this, while one landed in git would.
describe('tracked feature packages', () => {
  it('tracks only the known feature packages in git, regardless of what an overlay adds to disk', (ctx) => {
    // An assembled overlay tree is a copy with no .git, so this guard has
    // nothing to read there. Skip rather than fail: a red suite in an overlay
    // build invites someone to "fix" it by deleting the guard.
    //
    // Only "not a git repository" (what `git rev-parse` prints when cwd is
    // outside any work tree) skips. Any other failure, including a missing git
    // binary, still fails the test, so the guard cannot go quiet in CI.
    try {
      execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    } catch (err) {
      const stderr =
        err !== null && typeof err === 'object' && 'stderr' in err ? String((err as { stderr: unknown }).stderr) : ''
      if (stderr.includes('not a git repository')) {
        ctx.skip(
          'not a git work tree (an assembled overlay tree); this guard only applies to the repo itself'
        )
        return
      }
      throw err
    }

    const tracked = execFileSync('git', ['ls-files', '-s', 'src/features'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    const trackedPackageDirs = new Set<string>()
    for (const line of tracked.split('\n')) {
      if (line === '') continue
      const tabIndex = line.indexOf('\t')
      const mode = line.slice(0, tabIndex).split(' ')[0]
      const parts = line.slice(tabIndex + 1).split('/')
      // src/features/<package>/<file...> has more than 3 segments; a top-level
      // file directly under src/features/ has exactly 3 and names no package.
      // But a package committed as a symlink (mode 120000) or a gitlink (160000)
      // is one entry naming the directory itself, also 3 segments, so the mode
      // is what tells the two apart.
      const isPackageEntry = parts.length > 3 || (parts.length === 3 && (mode === '120000' || mode === '160000'))
      if (isPackageEntry) trackedPackageDirs.add(parts[2])
    }
    // EMPTY, and that is the point: no feature package belongs in this tree, so
    // a package directory tracked in git here is a feature committed to the
    // public repository. An overlay build copies its packages onto disk without
    // a .git, so the skip above is what keeps this from failing there.
    expect([...trackedPackageDirs].sort()).toEqual([])
  })
})
