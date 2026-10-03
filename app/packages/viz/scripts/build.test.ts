import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const out = mkdtempSync(join(tmpdir(), 'veodyn-viz-dist-'))
const read = (path: string) => readFileSync(join(out, path), 'utf8')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

beforeAll(() => {
  execFileSync('node', ['packages/viz/scripts/build.mjs', out], { stdio: 'pipe' })
}, 120_000)

const manifest = JSON.parse(readFileSync('packages/viz/package.json', 'utf8'))

function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Object.values(value as Record<string, unknown>).flatMap(exportTargets)
}

describe('the built package', () => {
  it('emits every file the manifest exports', () => {
    const missing = exportTargets(manifest.exports)
      .map((target) => target.replace(/^\.\/dist\//, ''))
      .filter((target) => !existsSync(join(out, target)))
    expect(missing).toEqual([])
  })

  it('marks the client entries as client modules and leaves the server entry alone', () => {
    expect(read('index.js').startsWith("'use client';")).toBe(true)
    expect(read('ui.js').startsWith("'use client';")).toBe(true)
    expect(read('normalize.js').startsWith("'use client'")).toBe(false)
  })

  it('emits declarations for every entry', () => {
    for (const entry of ['index.d.ts', 'ui.d.ts', 'normalize.d.ts']) expect(existsSync(join(out, entry)), entry).toBe(true)
  })

  it('keeps each renderer in its own module so hosts split them', () => {
    expect(existsSync(join(out, 'components/visualizations/heatmap-renderer.js'))).toBe(true)
    expect(existsSync(join(out, 'components/visualizations/map-renderer.js'))).toBe(true)
  })

  it('ships no tests and no app alias', () => {
    const js = files(out).filter((path) => path.endsWith('.js'))
    expect(js.filter((path) => /\.test\./.test(path))).toEqual([])
    expect(js.filter((path) => /from ['"]@\//.test(readFileSync(path, 'utf8')))).toEqual([])
  })

  it('spells every relative import out to a file, as strict ESM resolution requires', () => {
    const specifier = /(?:from\s*|import\s*\(\s*|^import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm
    const loose = files(out)
      .filter((path) => path.endsWith('.js') || path.endsWith('.d.ts'))
      .flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(specifier)]
          .map((m) => m[1])
          .filter((spec) => !spec.endsWith('.js') || !existsSync(join(path, '..', spec.replace(/\.js$/, path.endsWith('.d.ts') ? '.d.ts' : '.js'))))
          .map((spec) => `${path.slice(out.length + 1)}: ${spec}`)
      )
    expect(loose).toEqual([])
  })

  it('names a file for every package subpath that has no exports map', () => {
    const bare = /(?:from\s*|import\s*\(\s*|^import\s+)['"]((?:@[^/'"]+\/)?[^@./'"][^/'"]*)\/([^'"]+)['"]/gm
    const unresolvable = files(out)
      .filter((path) => path.endsWith('.js'))
      .flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(bare)].map((m) => ({ pkg: m[1], sub: m[2], path }))
      )
      .filter(({ pkg, sub }) => {
        const root = join(process.cwd(), 'node_modules', pkg)
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
        if (manifest.exports) return false
        const target = join(root, sub)
        return !existsSync(target) || statSync(target).isDirectory()
      })
      .map(({ pkg, sub, path }) => `${path.slice(out.length + 1)}: ${pkg}/${sub}`)
    expect(unresolvable).toEqual([])
  })

  it('rewrites source import extensions so a bundler can resolve them', () => {
    expect(read('lib/chart-palette.js')).not.toMatch(/from ['"][^'"]+\.ts['"]/)
  })

  it('builds a stylesheet scoped to the root and layered under the host', () => {
    const css = read('styles.css')
    expect(css).toContain('@layer veodyn')
    expect(css).toContain('.veodyn .bg-card')
    expect(css).not.toMatch(/(^|[\s,}]):root\b/)
    expect(css).not.toContain('!important')
  })

  it('carries both palettes and leaves the font to the host', () => {
    const css = read('styles.css')
    expect(css).toMatch(/\.veodyn\s*\{[^}]*--chart-1:/)
    expect(css).toMatch(/\.veodyn\[data-theme="dark"\][^{]*\{[^}]*--chart-1:/)
    expect(css).not.toMatch(/--font-sans-family\s*:/)
    expect(css).not.toMatch(/--font-display-family\s*:/)
  })

  it('puts the dark palette on the provider only, so nested boundaries inherit a host override', () => {
    const css = read('styles.css')
    expect(css).not.toMatch(/\.veodyn \[data-theme="dark"\][^{]*\{[^}]*--chart-1:/)
  })

  it('keeps a monospace stack for the parts that ask for one', () => {
    expect(read('styles.css')).toMatch(/--font-mono-family\s*:\s*ui-monospace/)
  })
})
