import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'packages/viz/src')
const RELATIVE_IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g

function resolveSource(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier)
  const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((candidate) => existsSync(candidate))
  if (!found) throw new Error(`cannot resolve ${specifier} from ${from}`)
  return found
}

function moduleGraph(entry: string): string[] {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file)) return
    seen.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(RELATIVE_IMPORT)) visit(resolveSource(file, match[1]))
  }
  visit(entry)
  return [...seen]
}

describe('the server-safe normalize entry', () => {
  it('pulls in no client module, so a server component or route handler can call it', () => {
    const clientModules = moduleGraph(join(SRC, 'normalize.ts'))
      .filter((file) => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))

    expect(clientModules).toEqual([])
  })

  it('exports the normaliser and the payload shape', async () => {
    const entry = await import('./normalize')

    expect(typeof entry.normalizePublicVisualization).toBe('function')
    expect(entry.PUBLIC_VISUALIZATION_ID).toBe(0)
  })

  it('detects a client module in a graph that has one', () => {
    const graph = moduleGraph(join(SRC, 'embed', 'veodyn-provider.tsx'))

    expect(graph.some((file) => /^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')))).toBe(true)
  })
})
