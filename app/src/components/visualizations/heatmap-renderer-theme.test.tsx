import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Task 5 fix round 3, important finding 2 (again). Round 2 tested the
// colorFor/inkFor memoization dependency with a jsdom spy counting how many
// times getSequentialScale/getSequentialInk were CALLED. The review pointed
// out (and this file's own math, run independently against chart-palette.ts,
// confirmed) that this asserted the wrong thing: getSequentialScale reads no
// token at all and cannot go stale by construction, so a call-count
// assertion on it asserts a non-requirement. Worse, the same style of
// assertion on getSequentialInk would have BLOCKED a strictly better future
// fix (resolving its tokens lazily inside the returned closure, which would
// make it live and remove the need for themeVersion as a memo dependency
// entirely). A test that blocks a better implementation is worse than no
// test, so that whole approach is replaced here with the actually OBSERVABLE
// behaviour: does the ink a cell paints change correctly on a real theme
// toggle.
//
// Real default tokens (not invented ones), matching chart-colors.test.ts's
// own LIGHT_TOKENS/DARK_TOKENS: with these, normalize() gives the domain's
// MAX value a mix of exactly 100% (bare --chart-1, no --card blended in),
// and light vs dark sit on OPPOSITE sides of the resulting contrast
// crossover for that specific colour. That is not a coincidence for this
// data: any dataset's own max-value cell lands at the same 100% mix, so the
// existing Tuesday/Evening: 34 fixture (already used by the "adaptive ink"
// test in heatmap-renderer.test.tsx) is the cell this test needs with no
// changes.
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
    // MutationObserver watches, AND the token values a browser's own .dark
    // selector would actually resolve to (jsdom runs no real CSS cascade, so
    // toggling the class alone would not otherwise change what
    // getComputedStyle returns for these custom properties).
    setTokens(DARK_TOKENS)
    await act(async () => {
      document.documentElement.classList.add('dark')
    })

    expect(maxCell).toHaveStyle({ color: 'var(--foreground)' })
  })
})
