import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.resolve(__dirname, '../..')
const ENTRIES = ['library-tools', 'saved-query-run', 'query-detail', 'query-edit', 'node-calls', 'viz-tools'].map(
  (name) => path.join(SRC, 'lib/chat', `${name}.ts`)
)
const API_CLIENT = path.join(SRC, 'services/api-client.ts')
const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?[^;]*?\sfrom\s+['"]([^'"]+)['"]/gm
const SIDE_EFFECT_RE = /^\s*import\s+['"]([^'"]+)['"]/gm

function resolveSpecifier(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? path.resolve(path.dirname(from), specifier)
      : null
  if (!base) return null
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
  if (existsSync(base) && statSync(base).isFile()) candidates.unshift(base)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const found: string[] = []
  for (const match of source.matchAll(IMPORT_RE)) {
    if (!match[1]) found.push(match[2])
  }
  for (const match of source.matchAll(SIDE_EFFECT_RE)) found.push(match[1])
  return found
}

function moduleGraph(entries: string[]): Set<string> {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file) || file === API_CLIENT) continue
    seen.add(file)
    for (const specifier of importsOf(file)) {
      const resolved = resolveSpecifier(file, specifier)
      if (resolved) queue.push(resolved)
    }
  }
  return seen
}

describe('chat executors stay transport-only', () => {
  const graph = [...moduleGraph(ENTRIES)]

  it('reaches every entry and its helpers', () => {
    expect(graph.length).toBeGreaterThan(ENTRIES.length)
    for (const entry of ENTRIES) expect(graph).toContain(entry)
  })

  it('never imports redashApi anywhere in the runtime module graph', () => {
    const offenders = graph.filter((file) => {
      const source = readFileSync(file, 'utf8')
      return importsOf(file).some((specifier) => /services\/redash\/(queries|dashboards|data-sources|execution|jobs)$/.test(specifier)) ||
        /import\s*\{[^}]*\bredashApi\b[^}]*\}/.test(source)
    })
    expect(offenders.map((file) => path.relative(SRC, file))).toEqual([])
  })
})
