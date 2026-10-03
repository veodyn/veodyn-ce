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
  })
})
