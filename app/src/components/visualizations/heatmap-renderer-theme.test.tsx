import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Asserts the observable thing: the ink a cell paints changes on a real theme
// toggle.
//
// Real default tokens, matching chart-colors.test.ts's own LIGHT_TOKENS and
// DARK_TOKENS. normalize() gives any domain's max value a mix of exactly 100%
// (bare --chart-1, no --card blended in), and light and dark sit on opposite
// sides of that colour's contrast crossover, so the max cell in this fixture
// (Tuesday/Evening: 34) is the cell this test needs.
const LIGHT_TOKENS = { card: '#FFFFFF', chart1: '#485EA7', foreground: '#1C1B18' }
const DARK_TOKENS = { card: '#12161F', chart1: '#4A61AA', foreground: '#E7E9EE' }

function setTokens(tokens: { card: string; chart1: string; foreground: string }): void {
  document.documentElement.style.setProperty('--card', tokens.card)
  document.documentElement.style.setProperty('--chart-1', tokens.chart1)
  document.documentElement.style.setProperty('--foreground', tokens.foreground)
}

const visualization: MockVisualization = {
  id: 1,
  type: 'HEATMAP',
  name: 'Test heatmap',
  description: '',
  options: {
    columnMapping: {
      weekday: 'x',
      period: 'y',
      count: 'value',
    },
  },
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
}

const data: QueryResultData = {
  columns: [
    { name: 'weekday', friendly_name: 'Weekday', type: 'string' },
    { name: 'period', friendly_name: 'Period', type: 'string' },
    { name: 'count', friendly_name: 'Count', type: 'integer' },
  ],
  rows: [
    { weekday: 'Monday', period: 'Morning', count: 12 },
    { weekday: 'Tuesday', period: 'Evening', count: 34 },
  ],
}

describe('HeatmapRenderer ink on a real theme toggle', () => {
  afterEach(() => {
    document.documentElement.className = ''
    document.documentElement.style.removeProperty('--card')
    document.documentElement.style.removeProperty('--chart-1')
    document.documentElement.style.removeProperty('--foreground')
  })

  it('recomputes the max-value cell\'s ink choice on a theme toggle, not just its own repaint', async () => {
    setTokens(LIGHT_TOKENS)
    render(<HeatmapRenderer visualization={visualization} data={data} />)
    const maxCell = screen.getByLabelText('Tuesday / Evening: 34')
    expect(maxCell).toHaveStyle({ color: 'var(--card)' })

    // A real theme toggle: the class change useThemeTokenVersion's
    // MutationObserver watches, plus the values a browser's .dark selector would
    // resolve to. jsdom runs no CSS cascade, so the class alone changes nothing
    // getComputedStyle returns for these custom properties.
    setTokens(DARK_TOKENS)
    await act(async () => {
      document.documentElement.classList.add('dark')
    })

    expect(maxCell).toHaveStyle({ color: 'var(--foreground)' })
  })
})
