import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { HeatmapRenderer } from './heatmap-renderer'

// Real defaults from globals.css (light theme), not invented values: with a
// made-up fixture, both the low-value and high-value cell can land on the
// SAME side of the contrast crossover and the discrimination test below would
// assert nothing. These are the exact tokens chart-colors.test.ts uses for
// its own getSequentialInk unit tests.
const LIGHT_TOKENS = { card: '#FFFFFF', chart1: '#485EA7', foreground: '#1C1B18' }

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

describe('HeatmapRenderer', () => {
  it('renders cells for mapped x, y, and value columns', () => {
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    expect(screen.getByLabelText('Monday / Morning: 12')).toHaveTextContent('12')
    expect(screen.getByLabelText('Tuesday / Evening: 34')).toHaveTextContent('34')
  })

  it('shows the empty state with insufficient columns', () => {
    const insufficientData: QueryResultData = {
      columns: [
        { name: 'weekday', friendly_name: 'Weekday', type: 'string' },
        { name: 'period', friendly_name: 'Period', type: 'string' },
      ],
      rows: [{ weekday: 'Monday', period: 'Morning' }],
    }

    render(
      <HeatmapRenderer
        visualization={{ ...visualization, options: {} }}
        data={insufficientData}
      />,
    )

    expect(
      screen.getByText('Heatmap requires x, y, and value columns.'),
    ).toBeInTheDocument()
  })

  it('sums duplicate cells by default', () => {
    const dupData: QueryResultData = {
      columns: data.columns,
      rows: [
        { weekday: 'Monday', period: 'Morning', count: 10 },
        { weekday: 'Monday', period: 'Morning', count: 5 },
      ],
    }
    render(<HeatmapRenderer visualization={visualization} data={dupData} />)
    expect(screen.getByLabelText('Monday / Morning: 15')).toBeInTheDocument()
  })

  it('counts rows per cell with aggregation: count and no value column', () => {
    const countViz: MockVisualization = {
      ...visualization,
      options: {
        columnMapping: { weekday: 'x', period: 'y' },
        aggregation: 'count',
      },
    }
    const countData: QueryResultData = {
      columns: data.columns.slice(0, 2),
      rows: [
        { weekday: 'Monday', period: 'Morning' },
        { weekday: 'Monday', period: 'Morning' },
        { weekday: 'Tuesday', period: 'Evening' },
      ],
    }
    render(<HeatmapRenderer visualization={countViz} data={countData} />)
    expect(screen.getByLabelText('Monday / Morning: 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Tuesday / Evening: 1')).toBeInTheDocument()
  })

  it('averages duplicate cells with aggregation: avg', () => {
    const avgViz: MockVisualization = {
      ...visualization,
      options: { ...visualization.options, aggregation: 'avg' },
    }
    const dupData: QueryResultData = {
      columns: data.columns,
      rows: [
        { weekday: 'Monday', period: 'Morning', count: 10 },
        { weekday: 'Monday', period: 'Morning', count: 20 },
      ],
    }
    render(<HeatmapRenderer visualization={avgViz} data={dupData} />)
    expect(screen.getByLabelText('Monday / Morning: 15')).toBeInTheDocument()
  })

  describe('label ink', () => {
    afterEach(() => {
      document.documentElement.style.removeProperty('--card')
      document.documentElement.style.removeProperty('--chart-1')
      document.documentElement.style.removeProperty('--foreground')
    })

    it('gives the low-value and high-value cells different ink against the real default tokens', () => {
      // Against these exact tokens, getSequentialInk's own unit tests
      // (chart-colors.test.ts) establish the floor of any domain picks
      // foreground ink and the ceiling picks card ink. A hardcoded
      // var(--foreground) on every cell would make both assertions below
      // read the same value and this test would fail.
      document.documentElement.style.setProperty('--card', LIGHT_TOKENS.card)
      document.documentElement.style.setProperty('--chart-1', LIGHT_TOKENS.chart1)
      document.documentElement.style.setProperty('--foreground', LIGHT_TOKENS.foreground)

      render(<HeatmapRenderer visualization={visualization} data={data} />)

      const lowValueCell = screen.getByLabelText('Monday / Morning: 12')
      const highValueCell = screen.getByLabelText('Tuesday / Evening: 34')

      expect(lowValueCell).toHaveStyle({ color: 'var(--foreground)' })
      expect(highValueCell).toHaveStyle({ color: 'var(--card)' })
      expect(lowValueCell.style.color).not.toBe(highValueCell.style.color)
    })
  })

  describe('value density', () => {
    // 13 distinct weekdays x 13 distinct periods = 169 grid cells, past the
    // 150-cell auto threshold, but only the 13 diagonal pairs actually carry a
    // row. This is deliberately sparse: cellCount is the size of the GRID
    // (xCategories.length * yCategories.length), not how many cells are
    // populated, so a sparse-but-wide grid must be just as noisy under auto as
    // a dense one of the same size.
    const wideRows = Array.from({ length: 13 }, (_, i) => ({
      weekday: `Day ${i}`,
      period: `Period ${i}`,
      count: i + 1,
    }))
    const wideData: QueryResultData = { columns: data.columns, rows: wideRows }

    it('hides values under the default auto mode once the grid exceeds 150 cells, even though the grid is sparse', () => {
      render(<HeatmapRenderer visualization={visualization} data={wideData} />)

      const cell = screen.getByLabelText('Day 0 / Period 0: 1')
      expect(cell).toBeEmptyDOMElement()
    })

    it('still shows values under auto on a small grid at or under 150 cells', () => {
      render(<HeatmapRenderer visualization={visualization} data={data} />)

      expect(screen.getByLabelText('Monday / Morning: 12')).toHaveTextContent('12')
    })

    it('forces values on with showValues: always, even past the 150-cell threshold', () => {
      const alwaysViz: MockVisualization = {
        ...visualization,
        options: { ...visualization.options, showValues: 'always' },
      }
      render(<HeatmapRenderer visualization={alwaysViz} data={wideData} />)

      expect(screen.getByLabelText('Day 0 / Period 0: 1')).toHaveTextContent('1')
    })

    it('forces values off with showValues: never, even on a small grid', () => {
      const neverViz: MockVisualization = {
        ...visualization,
        options: { ...visualization.options, showValues: 'never' },
      }
      render(<HeatmapRenderer visualization={neverViz} data={data} />)

      expect(screen.getByLabelText('Monday / Morning: 12')).toBeEmptyDOMElement()
    })
  })

  describe('outlier clipping', () => {
    // 100 ordinary cells with values 1..100, plus one cell at 1,000,000: the
    // same shape heatmap-model.test.ts uses to prove the domain narrows to
    // [3, 99] under clipOutliers. Row 98 (value 99) lands exactly on the
    // clipped ceiling, so it and the far larger outlier both normalize to the
    // scale's top and must paint identically once clamped.
    const clusterRows = Array.from({ length: 100 }, (_, i) => ({
      weekday: `Row ${i}`,
      period: 'Morning',
      count: i + 1,
    }))
    const outlierData: QueryResultData = {
      columns: data.columns,
      rows: [...clusterRows, { weekday: 'Outlier', period: 'Morning', count: 1_000_000 }],
    }
    const clippedViz: MockVisualization = {
      ...visualization,
      options: { ...visualization.options, clipOutliers: true },
    }

    it('still renders the outlier cell rather than hiding it', () => {
      render(<HeatmapRenderer visualization={clippedViz} data={outlierData} />)

      expect(screen.getByLabelText('Outlier / Morning: 1000000')).toBeInTheDocument()
    })

    it('clamps the outlier cell to the same endpoint colour as an ordinary cell at the clipped ceiling, rather than recolouring it as though it were inside the range', () => {
      render(<HeatmapRenderer visualization={clippedViz} data={outlierData} />)

      const topOrdinaryCell = screen.getByLabelText('Row 98 / Morning: 99')
      const outlierCell = screen.getByLabelText('Outlier / Morning: 1000000')
      expect(outlierCell.style.backgroundColor).toBe(topOrdinaryCell.style.backgroundColor)
    })

    it('announces the clip in the legend', () => {
      render(<HeatmapRenderer visualization={clippedViz} data={outlierData} />)

      expect(screen.getByText(/clipped/i)).toBeInTheDocument()
    })

    it('does not announce a clip when clipOutliers is not set, even with the same outlier data', () => {
      render(<HeatmapRenderer visualization={visualization} data={outlierData} />)

      expect(screen.queryByText(/clipped/i)).not.toBeInTheDocument()
    })
  })

  describe('value label resolution', () => {
    // Guards the Task 4 cleanup that folded the value column's label into
    // HeatmapModel: the renderer no longer calls resolveColumns a second time
    // to get it, so this has to keep working off the model alone.
    it('labels the legend with the value column\'s friendly_name', () => {
      render(<HeatmapRenderer visualization={visualization} data={data} />)

      expect(screen.getByText('Count')).toBeInTheDocument()
    })
  })
})
