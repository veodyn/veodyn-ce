import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const PACKAGE_SRC = join(process.cwd(), 'packages/viz/src')

const ALLOWED_EXTERNALS = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@tanstack/react-query',
  'recharts',
  'recharts/types/chart/Sankey',
  'maplibre-gl',
  'maplibre-gl/dist/maplibre-gl.css',
  'react-map-gl/maplibre',
  'd3-cloud',
  'd3-hierarchy',
  'd3-shape',
  'date-fns',
  'lucide-react',
  'geojson',
  'class-variance-authority',
  'clsx',
  'tailwind-merge',
])

const ALLOWED_EXTERNAL_PREFIXES = ['@base-ui/react/']

const IMPORT_SPECIFIER = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g

const COMMENTS = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm

function escapesPackage(specifier: string, file: string): boolean {
  const target = resolve(dirname(file), specifier)
  return target !== PACKAGE_SRC && !target.startsWith(PACKAGE_SRC + sep)
}

export function forbiddenImports(source: string, file: string): string[] {
  const offenders: string[] = []
  const code = source.replace(COMMENTS, '')
  for (const match of code.matchAll(IMPORT_SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? match[3]
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      if (escapesPackage(specifier, file)) offenders.push(specifier)
      continue
    }
    if (ALLOWED_EXTERNALS.has(specifier)) continue
    if (ALLOWED_EXTERNAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) continue
    offenders.push(specifier)
  }
  return offenders
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) return []
    return [path]
  })
}

describe('the @veodyn/viz import boundary', () => {
  it('reports an app alias, a deep app path and an undeclared package', () => {
    const source = [
      "import { cn } from '@/lib/utils'",
      "import type { X } from '../../../../../src/lib/x'",
      "const Lazy = import('@/components/visualizations/box-plot-renderer')",
      "export { y } from 'left-pad'",
      "import { useMemo } from 'react'",
      "import { Popover } from '@base-ui/react/popover'",
      "import './local.css'",
      "// This barrel deliberately does NOT import '@/plugins'.",
      "/* nor import '@/stores/auth-store' */",
    ].join('\n')

    const file = join(PACKAGE_SRC, 'components', 'visualizations', 'probe.tsx')

    expect(forbiddenImports(source, file)).toEqual([
      '@/lib/utils',
      '../../../../../src/lib/x',
      '@/components/visualizations/box-plot-renderer',
      'left-pad',
    ])
  })

  it('holds for every non-test source file in the package', () => {
    const offenders = sourceFiles(PACKAGE_SRC).flatMap((file) =>
      forbiddenImports(readFileSync(file, 'utf8'), file).map((specifier) => `${relative(PACKAGE_SRC, file)}: ${specifier}`)
    )

    expect(offenders).toEqual([])
  })
})
