// The import boundary every plugin package has to stay inside.
//
// A plugin is a per-customer integration the product does not maintain (see
// docs/visualization-plugins.md). That only holds while a plugin reaches the
// app through `VisualizationPlugin` and nothing else: the moment one imports a
// product component directly, changing that component becomes a plugin-breaking
// change and the package is back on the product's plate.
//
// Asserting on source text rather than on a bundle is deliberate: a forbidden
// import is a design regression the moment it is written, not the moment it
// ships.
//
// This lived inside the tenant package's own test and globbed that one
// directory, so it enforced the boundary for that package alone. A second
// package would have arrived with no check at all and nothing would have
// failed. Packages are
// discovered here for the same reason files are: a list is a thing somebody
// forgets to extend, so the directory is the list.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const PLUGINS_ROOT = join(process.cwd(), 'src/plugins')

/** Every plugin package: one directory under src/plugins. */
const PACKAGES = readdirSync(PLUGINS_ROOT)
  .filter((name) => statSync(join(PLUGINS_ROOT, name)).isDirectory())
  .sort()

// Every source extension the build can actually consume, not just .ts/.tsx:
// tsconfig.json enables allowJs, so an overlaid package can ship a
// renderer.jsx (or a plain .js helper) that index.ts imports, and that file
// must be scanned exactly like a .ts file, or it is a hole an overlay build
// can import anything through.
const SOURCE_EXTENSIONS = /\.(?:tsx|ts|jsx|js|mjs|cjs|mts|cts)$/

/**
 * Every source file in every package, as a path relative to src/plugins, so a
 * failure names the package as well as the file.
 *
 * Recursive because nothing stops a package from having subdirectories; every
 * package present happens to be flat today, and a guard that assumed so would
 * skip the first nested file silently.
 */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) return sourceFilesUnder(abs)
    if (!SOURCE_EXTENSIONS.test(name) || name.includes('.test.')) return []
    return [relative(PLUGINS_ROOT, abs)]
  })
}

const FILES = PACKAGES.flatMap((pkg) => sourceFilesUnder(join(PLUGINS_ROOT, pkg))).sort()

const ALLOWED = [
  'react',
  'lucide-react',
  '@/lib/visualizations',
  '@/lib/mock-data',
  // A map plugin cannot avoid these: both core map renderers import the same
  // stylesheet for popup and attribution chrome.
  'react-map-gl/maplibre',
  'maplibre-gl/dist/maplibre-gl.css',
]

// `@/components/ui/` is part of the plugin API by decision, not by accident: a
// plugin editor should look like the product's, and out-of-tree packages get
// these primitives shipped to them. It is the one product directory a plugin
// may reach into, and the promise it carries is that these primitives do not
// break under a plugin.
const ALLOWED_PREFIXES = ['@/components/ui/', './', '../']

// Comments are stripped first, so the guard can describe the boundary it
// enforces without tripping over its own prose. A forbidden import can only
// appear in code, so nothing real hides behind this.
//
// A state machine rather than two regexes: the header comment of
// camera-slider.ts contains the literal "@/components/ui/*", and a
// block-comment regex reads that stray "/*" as the start of a comment and eats
// every import in the file. The "sees the imports it is checking" case below is
// what caught that, and is what keeps this honest.
//
// Known gaps, not fixed here on purpose (kept small and separate rather than
// folded into this pass):
//   - A template-literal import specifier, e.g. import(`./foo/${x}`), is not
//     seen at all: importsIn() only matches a quoted string after
//     from/import/require, so a dynamic import built from a template string
//     passes through unchecked.
//   - stripComments() does not understand string literals, so a string that
//     contains the literal text "/*" would make it swallow the rest of the
//     file as if a block comment had started there.
// Neither makes this guard airtight; both need their own care rather than
// riding along with the extension-coverage fix below.
function stripComments(source: string): string {
  const lines: string[] = []
  let inBlock = false
  for (const line of source.split('\n')) {
    let rest = line
    let kept = ''
    while (rest !== '') {
      if (inBlock) {
        const end = rest.indexOf('*/')
        if (end === -1) break
        rest = rest.slice(end + 2)
        inBlock = false
        continue
      }
      const block = rest.indexOf('/*')
      const eol = rest.indexOf('//')
      if (block === -1 && eol === -1) {
        kept += rest
        break
      }
      // Whichever opens first wins, so a "/*" inside a line comment does not
      // start a block and a "//" inside a block does not end the line.
      if (eol !== -1 && (block === -1 || eol < block)) {
        kept += rest.slice(0, eol)
        break
      }
      kept += rest.slice(0, block)
      rest = rest.slice(block + 2)
      inBlock = true
    }
    lines.push(kept)
  }
  return lines.join('\n')
}

function code(file: string): string {
  return stripComments(readFileSync(join(PLUGINS_ROOT, file), 'utf8'))
}

// The lookbehind is load-bearing. Without it the `from` inside an ordinary
// identifier is read as the keyword: `'effective_from']` matched, and the
// capture ran from the following bracket to the next quote in the file, so a
// column name reported the whole plugin declaration as a forbidden import.
// Found by the ticker, whose time-column candidates include effective_from.
function importsIn(source: string): string[] {
  return [...source.matchAll(/(?<![\w$.])(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1]
  )
}

function offendersIn(source: string): string[] {
  return importsIn(source).filter(
    (specifier) =>
      !ALLOWED.includes(specifier) && !ALLOWED_PREFIXES.some((p) => specifier.startsWith(p))
  )
}

describe('plugin import boundary', () => {
  it.each(FILES)('%s imports only from the plugin surface', (file) => {
    expect(offendersIn(code(file))).toEqual([])
  })

  it.each(FILES)('%s never names the app visualization components', (file) => {
    // A substring check as well as the import list, so a dynamic import(), a
    // require, or a vi.mock path is caught too.
    expect(code(file)).not.toContain('components/visualizations')
  })
})

// A guard that matches nothing is a guard that cannot fail. Everything below
// pins that this one sees real code, covers every package, and would report a
// forbidden import rather than quietly skip it.
describe('plugin import boundary, self-checks', () => {
  // Deliberately not an exact list. A new package must be covered the moment it
  // lands, without anyone remembering to edit this file, which is the whole
  // reason the guard moved up here. Asserting equality with a fixed list would
  // put the forgettable list straight back.
  it('finds the packages on disk, so a new one is covered on arrival', () => {
    expect(PACKAGES).toContain('example')
    expect(PACKAGES.length).toBeGreaterThan(0)
  })

  // The failure this file exists to prevent: a package present on disk that
  // contributes no files leaves its own boundary unchecked while the suite
  // stays green, which is exactly how one tenant-package module went
  // unguarded.
  it.each(PACKAGES)('%s contributes source files to the guard', (pkg) => {
    expect(FILES.filter((f) => f.startsWith(`${pkg}${sep}`)).length).toBeGreaterThan(0)
  })

  it('finds every plugin source file', () => {
    // 2 is what the example package contributes today (hello-panel.ts,
    // index.ts). Not 0: a package that stops contributing files must still
    // fail this, which is the exact failure this file exists to catch.
    expect(FILES.length).toBeGreaterThanOrEqual(2)
    expect(FILES).toEqual(
      expect.arrayContaining([join('example', 'hello-panel.ts'), join('example', 'index.ts')])
    )
  })

  // The guard has to see real imports and only real imports. A matcher this
  // eager fails in the expensive direction: it reported a forbidden import that
  // did not exist, and the obvious fix would have been to rename the innocent
  // identifier rather than the broken regex.
  it('reads an import as an import and an identifier as an identifier', () => {
    expect(importsIn("import { a } from '@/lib/visualizations'")).toEqual(['@/lib/visualizations'])
    expect(importsIn("import './side-effect'")).toEqual(['./side-effect'])
    expect(importsIn("const x = require('node:fs')")).toEqual(['node:fs'])
    expect(importsIn("const C = ['effective_from', 'x']")).toEqual([])
    expect(importsIn("const C = ['transform', 'valid_from']")).toEqual([])
  })

  it('sees the imports it is checking', () => {
    expect(importsIn(code(join('example', 'hello-panel.ts')))).toEqual(
      expect.arrayContaining(['lucide-react', '@/lib/visualizations', '@/components/ui/card'])
    )
    expect(importsIn(code(join('example', 'index.ts')))).toEqual(
      expect.arrayContaining(['@/lib/visualizations', './hello-panel'])
    )
  })

  it('catches a forbidden import in code, and ignores one written in a comment', () => {
    const offending = [
      "import { MapRenderer } from '@/components/visualizations/map-renderer'",
      "import Image from 'next/image'",
      "const mod = await import('@/lib/env')",
    ].join('\n')
    expect(offendersIn(offending)).toEqual([
      '@/components/visualizations/map-renderer',
      'next/image',
      '@/lib/env',
    ])
    expect(offendersIn(code(join('example', 'hello-panel.ts')))).toEqual([])
    expect(
      offendersIn(stripComments("// import x from '@/components/visualizations/map-renderer'"))
    ).toEqual([])
  })
})
