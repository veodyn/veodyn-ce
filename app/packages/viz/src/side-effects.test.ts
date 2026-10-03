import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = join(process.cwd(), 'packages/viz')
const SRC = join(PACKAGE_ROOT, 'src')
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
const BARE_IMPORT = /^import\s+['"](\.{1,2}\/[^'"]+)['"]/gm

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : []
  })
}

function resolveSource(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {}
  }
  return base
}

function sideEffectModules(): string[] {
  const modules = sourceFiles(SRC).flatMap((file) => {
    const targets = [...readFileSync(file, 'utf8').matchAll(BARE_IMPORT)]
      .map((match) => match[1])
      .filter((specifier) => !specifier.endsWith('.css'))
      .map((specifier) => relative(PACKAGE_ROOT, resolveSource(file, specifier)))
    return targets.length > 0 ? [relative(PACKAGE_ROOT, file), ...targets] : []
  })
  return [...new Set(modules)].sort()
}

describe('package side effects', () => {
  it('finds the core registration module and the barrel that imports it', () => {
    expect(sideEffectModules()).toEqual(
      expect.arrayContaining(['src/lib/visualizations/core.ts', 'src/lib/visualizations/index.ts'])
    )
  })

  it.each(sideEffectModules())('declares %s side-effectful in source and built form', (module) => {
    const built = module.replace(/^src\//, 'dist/').replace(/\.tsx?$/, '.js')
    expect(manifest.sideEffects).toEqual(expect.arrayContaining([`./${module}`, `./${built}`]))
  })
})
