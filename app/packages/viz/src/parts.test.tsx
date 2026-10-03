import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChartLegend } from './components/visualizations/chart/chart-legend'
import { ChartTooltip } from './components/visualizations/chart/chart-tooltip'
import { VisualizationRenderer } from './components/visualizations/visualization-renderer'
import { QueryResultTable } from './components/query/query-result-table'
import './lib/visualizations'
import { DEFAULT_DISPLAY_PATTERNS } from './lib/date-pattern'
import { PARTS } from './parts'
import type { MockVisualization, QueryResultData } from './types/viz-data'

const SRC = join(process.cwd(), 'packages/viz/src')
const PART_LITERAL = /data-veodyn-part['"]?\s*[=:]\s*\{?\s*['"]([a-z-]+)['"]/g

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : []
  })
}

const usedParts = new Set(sources(SRC).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(PART_LITERAL)].map((m) => m[1])))

function viz(type: string, options: Record<string, unknown> = {}): MockVisualization {
  return { id: 1, type, name: `${type} widget`, description: '', options, created_at: '', updated_at: '' }
}

const ROWS: QueryResultData = {
  columns: [
    { name: 'route', friendly_name: 'Route', type: 'string' },
    { name: 'riders', friendly_name: 'Riders', type: 'integer' },
  ],
  rows: Array.from({ length: 60 }, (_, n) => ({ route: `R${n}`, riders: n * 10 })),
}

const part = (container: HTMLElement, name: string) => container.querySelectorAll(`[data-veodyn-part="${name}"]`)

describe('the part vocabulary', () => {
  it('names every part the source stamps', () => {
    expect([...usedParts].filter((name) => !PARTS.includes(name as (typeof PARTS)[number]))).toEqual([])
  })

  it('reads both spellings of a part in source', () => {
    const source = `<div data-veodyn-part="chart" />\nconst props = { 'data-veodyn-part': 'visualization' }`

    expect([...source.matchAll(PART_LITERAL)].map((m) => m[1])).toEqual(['chart', 'visualization'])
  })

  it('stamps every part it names', () => {
    expect(PARTS.filter((name) => !usedParts.has(name))).toEqual([])
  })
})

describe('parts a host can style', () => {
  it('marks each visualization with its part and type', async () => {
    const { container } = render(<VisualizationRenderer visualization={viz('COUNTER')} data={ROWS} />)

    await screen.findByText('COUNTER widget')
    const root = container.querySelector('[data-veodyn-part="visualization"]')
    expect(root).toHaveAttribute('data-veodyn-type', 'COUNTER')
  })

  it('marks the counter value and label', async () => {
    const { container } = render(<VisualizationRenderer visualization={viz('COUNTER')} data={ROWS} />)

    await screen.findByText('COUNTER widget')
    expect(part(container, 'counter')).toHaveLength(1)
    expect(part(container, 'counter-value')[0]).toHaveTextContent('0')
    expect(part(container, 'counter-label')[0]).toHaveTextContent('COUNTER widget')
  })

  it('marks the counter trend when there is a target', async () => {
    const { container } = render(
      <VisualizationRenderer visualization={viz('COUNTER', { counterColName: 'riders', targetRowNumber: 2 })} data={ROWS} />
    )

    await screen.findByText('COUNTER widget')
    expect(part(container, 'counter-trend')).toHaveLength(1)
  })

  it('marks the table, its toolbar, head, rows, cells and pagination', () => {
    const { container } = render(<QueryResultTable data={ROWS} />)

    expect(part(container, 'table')).toHaveLength(1)
    expect(part(container, 'table-toolbar')).toHaveLength(1)
    expect(part(container, 'table-head')).toHaveLength(2)
    expect(part(container, 'table-row')).toHaveLength(50)
    expect(part(container, 'table-cell')).toHaveLength(100)
    expect(part(container, 'pagination')).toHaveLength(1)
  })

  it('marks the problems panel when options name a missing column', async () => {
    const { container } = render(
      <VisualizationRenderer visualization={viz('COUNTER', { counterColName: 'absent' })} data={ROWS} />
    )

    await screen.findAllByText(/absent/)
    expect(part(container, 'problems')).toHaveLength(1)
  })

  it('marks the chart legend and its items', () => {
    const { container } = render(
      <ChartLegend payload={[{ value: 'riders', color: '#000', type: 'line' }, { value: 'trips', color: '#111', type: 'line' }]} />
    )

    expect(part(container, 'legend')).toHaveLength(1)
    expect(part(container, 'legend-item')).toHaveLength(2)
  })

  it('marks the chart tooltip', () => {
    const { container } = render(
      <ChartTooltip active label="Mon" patterns={DEFAULT_DISPLAY_PATTERNS} payload={[{ name: 'riders', value: 4, color: '#000', dataKey: 'riders', graphicalItemId: 'riders' }]} />
    )

    expect(part(container, 'tooltip')).toHaveLength(1)
  })

  it('marks an empty state', async () => {
    const { container } = render(<VisualizationRenderer visualization={viz('DETAILS')} data={{ columns: [], rows: [] }} />)

    await screen.findByText('No data to display.')
    expect(part(container, 'empty')).toHaveLength(1)
  })

  it('marks the details record view', async () => {
    const { container } = render(<VisualizationRenderer visualization={viz('DETAILS')} data={ROWS} />)

    await screen.findByText('R0')
    expect(part(container, 'details')).toHaveLength(1)
  })
})
