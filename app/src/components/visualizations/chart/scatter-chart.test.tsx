import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { render, screen, within } from '@testing-library/react'
import { ScatterChart } from './scatter-chart'
import type { ResolvedChartConfig } from './resolve-config'
import type { QueryResultData } from '@/lib/mock-data'

// recharts' ResponsiveContainer never renders past a zero-size host in
// jsdom; see line-area-chart.annotations.test.tsx for the full rationale.
// Per element rather than one rect for everything: a legend measured at the
// full 400px eats the entire plot height and recharts draws zero marks (the
// trap line-area-chart.combo.test.tsx documents), which the fill assertion
// below would misread as "the color was not honored".
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.classList.contains('recharts-legend-wrapper') ? 24 : 400
    return {
      width: 800,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON() {
        return this
      },
    } as DOMRect
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const config: ResolvedChartConfig = {
  chartType: 'scatter',
  xCol: 'x',
  yRightCols: [],
  seriesCol: 'region',
  effectiveYCols: ['y'],
  indexed: false,
  stacking: 'disabled',
  xIsDatetime: false,
  xHasTime: false,
  swappedAxes: false,
  reverseX: false,
  showDataLabels: false,
  donut: false,
  seriesOptions: {},
  yAxis: [],
  referenceLines: [],
}

// One row has a series value, the other has none (undefined survives a mock
// row shaped like a sparse query result). Two distinct groups is required for
// the legend to mount at all (seriesGroups.size >= 2).
const data: QueryResultData = {
  columns: [
    { name: 'x', friendly_name: 'X', type: 'integer' },
    { name: 'y', friendly_name: 'Y', type: 'integer' },
    { name: 'region', friendly_name: 'Region', type: 'string' },
  ],
  rows: [
    { x: 1, y: 10, region: 'North' },
    { x: 2, y: 20 },
  ],
}

describe('ScatterChart groupBy fallback label', () => {
  it('never shows the literal string "undefined" as a series name', () => {
    render(<ScatterChart config={config} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    expect(screen.queryByText('undefined')).not.toBeInTheDocument()
  })

  it('gives the row missing its series value an honest fallback label, not "undefined"', () => {
    render(<ScatterChart config={config} data={data} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    const legend = screen.getByRole('list', { name: 'Chart legend' })
    const items = within(legend).getAllByRole('listitem')
    expect(items).toHaveLength(2)

    // Each <li> holds exactly one label text node beside its aria-hidden
    // swatch, so comparing per-item text (rather than the concatenated list
    // textContent, which runs the two labels together with no separator)
    // is what actually pins the fallback row's own label.
    const labels = items.map((li) => li.textContent)
    expect(labels).toContain('North')
    expect(labels).not.toContain('undefined')
  })

  // An empty-string series value used to keep the key '', which collided with
  // the anonymous no-series-column group: the mark's `name || config.xCol`
  // fallback then rerouted its color lookup to the x column's name, so a color
  // stored by the editor under the group's own key was never read.
  it('groups an empty-string series value under the Ungrouped label and honors its stored color', () => {
    const { container } = render(
      <ScatterChart
        config={{ ...config, seriesOptions: { Ungrouped: { color: 'var(--chart-4)' } } }}
        data={{
          ...data,
          rows: [
            { x: 1, y: 10, region: 'North' },
            { x: 2, y: 20, region: '' },
          ],
        }}
        patterns={DEFAULT_DISPLAY_PATTERNS}
      />,
    )

    const legend = screen.getByRole('list', { name: 'Chart legend' })
    expect(within(legend).getByText('Ungrouped')).toBeInTheDocument()
    const fills = Array.from(container.querySelectorAll('.recharts-symbols')).map((mark) =>
      mark.getAttribute('fill'),
    )
    expect(fills).toContain('var(--chart-4)')
  })
})
