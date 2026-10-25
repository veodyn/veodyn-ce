// @vitest-environment node
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'packages/viz/src')
const ENTRIES = [join(SRC, 'authoring.ts'), join(SRC, 'lib/visualizations/authoring/index.ts')]

const COMMENTS = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm
const TYPE_ONLY = /(?:import|export)\s+type\s[^'"]*?from\s*['"][^'"]+['"]/g
const SPECIFIER =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
const DOM_GLOBALS = /\b(window|document|navigator|localStorage|sessionStorage)\b/

const FORBIDDEN_FRAGMENTS = [`${sep}components${sep}`, `${sep}hooks${sep}`, `${sep}embed${sep}`]
const FORBIDDEN_FILES = ['core.ts', 'index.ts', 'lazy-components.ts', 'map-providers.tsx']

function resolveSource(from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier)
  const candidates = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
}

function runtimeSpecifiers(source: string): string[] {
  const code = source.replace(COMMENTS, '').replace(TYPE_ONLY, '')
  return [...code.matchAll(SPECIFIER)].map((m) => m[1] ?? m[2] ?? m[3])
}

function closure(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    const specifiers = runtimeSpecifiers(readFileSync(file, 'utf8'))
    seen.set(file, specifiers)
    for (const specifier of specifiers) {
      if (!specifier.startsWith('.')) continue
      const target = resolveSource(file, specifier)
      if (target) queue.push(target)
    }
  }
  return seen
}

const GRAPH = closure(ENTRIES)
const rel = (file: string) => relative(SRC, file)

describe('the authoring entry stays free of React and the DOM', () => {
  it('reaches the authoring module files', () => {
    const files = [...GRAPH.keys()].map(rel)
    expect(files).toContain(join('lib', 'visualizations', 'authoring', 'core-authoring.ts'))
    expect(files).toContain(join('lib', 'visualizations', 'registry.ts'))
  })

  it('imports no bare package at runtime', () => {
    const offenders = [...GRAPH].flatMap(([file, specifiers]) =>
      specifiers.filter((s) => !s.startsWith('.')).map((s) => `${rel(file)}: ${s}`)
    )
    expect(offenders).toEqual([])
  })

  it('imports no react', () => {
    const offenders = [...GRAPH].flatMap(([file, specifiers]) =>
      specifiers.filter((s) => /^react($|\/|-)/.test(s)).map((s) => `${rel(file)}: ${s}`)
    )
    expect(offenders).toEqual([])
  })

  it('reaches no tsx file', () => {
    expect([...GRAPH.keys()].filter((f) => f.endsWith('.tsx')).map(rel)).toEqual([])
    const specifiers = [...GRAPH.values()].flat()
    expect(specifiers.filter((s) => s.endsWith('.tsx'))).toEqual([])
  })

  it('reaches no renderer, component, hook or barrel module', () => {
    const offenders = [...GRAPH.keys()].filter((file) => {
      const path = file.slice(SRC.length)
      const lib = path.startsWith(`${sep}lib${sep}visualizations${sep}`)
      const name = path.split(sep).pop() as string
      const barrelOrRenderer = lib && dirname(path).endsWith('visualizations') && FORBIDDEN_FILES.includes(name)
      return barrelOrRenderer || FORBIDDEN_FRAGMENTS.some((fragment) => path.includes(fragment))
    })
    expect(offenders.map(rel)).toEqual([])
  })

  it('touches no DOM global', () => {
    const offenders = [...GRAPH.keys()].filter((file) =>
      DOM_GLOBALS.test(readFileSync(file, 'utf8').replace(COMMENTS, ''))
    )
    expect(offenders.map(rel)).toEqual([])
  })
})
