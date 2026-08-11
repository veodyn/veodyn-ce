import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'

vi.mock('./choropleth-renderer', () => ({ ChoroplethRenderer: () => <div>choropleth-ok</div> }))
vi.mock('./cohort-renderer', () => ({ CohortRenderer: () => <div>cohort-ok</div> }))
vi.mock('./sunburst-renderer', () => ({ SunburstRenderer: () => <div>sunburst-ok</div> }))
vi.mock('./word-cloud-renderer', () => ({ WordCloudRenderer: () => <div>word-cloud-ok</div> }))

import { VisualizationRenderer } from './visualization-renderer'
import { VisualizationErrorBoundary } from './visualization-error-boundary'

const data: QueryResultData = { columns: [], rows: [] }
function viz(type: string): MockVisualization {
  return { id: 1, type, name: type, description: '', options: {}, created_at: '', updated_at: '' }
}

describe('VisualizationRenderer dispatch (parity types)', () => {
  it.each([
    ['CHOROPLETH', 'choropleth-ok'],
    ['COHORT', 'cohort-ok'],
    ['SUNBURST_SEQUENCE', 'sunburst-ok'],
    ['WORD_CLOUD', 'word-cloud-ok'],
    // findBy rather than getBy throughout this file: registered renderers are
    // loaded on demand, so the first render of a type is the Suspense fallback
    // and the renderer appears a microtask later. The dispatch being asserted
    // is unchanged; only when its result is on screen has moved.
  ])('routes %s to its renderer', async (type, text) => {
    render(<VisualizationRenderer visualization={viz(type)} data={data} />)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('still shows the muted default for an unknown type', () => {
    render(<VisualizationRenderer visualization={viz('NOPE')} data={data} />)
    expect(screen.getByText(/unsupported visualization type: NOPE/i)).toBeInTheDocument()
  })

  // The two CHART cases below mount through the providers, unlike the mocked
  // renderers above: a real ChartRenderer reads Settings > Formats to know which
  // form to write its dates in, and that is a query hook.
  //
  // The regression that motivated the validate hook: a chart mapping a column
  // its query stopped returning drew correct axes and no series, and said
  // nothing, so it read as a genuine "no data" answer.
  it('says which mapped column is missing instead of drawing a silent blank', () => {
    const bikes: QueryResultData = {
      columns: [{ name: 'name', friendly_name: 'name', type: 'string' }],
      rows: [],
    }
    const chart = { ...viz('CHART'), options: { columnMapping: { capacity: 'y' } } }

    renderWithProviders(<VisualizationRenderer visualization={chart} data={bikes} />)

    // Synchronous on purpose, and the point of the assertion: the problems list
    // is derived from options and data, so it must be readable BEFORE the
    // renderer's chunk arrives. A reader told why a chart is blank only after
    // the chart loads has been told too late, and if the chunk fails they are
    // never told at all.
    expect(screen.getByRole('status')).toHaveTextContent(
      'The y column "capacity" is not in this query result.'
    )
  })

  it('stays quiet when every mapped column resolves', () => {
    const bikes: QueryResultData = {
      columns: [{ name: 'name', friendly_name: 'name', type: 'string' }],
      rows: [],
    }
    const chart = { ...viz('CHART'), options: { columnMapping: { name: 'y' } } }

    renderWithProviders(<VisualizationRenderer visualization={chart} data={bikes} />)

    // Also synchronous, and this one additionally pins that the loading
    // placeholder is NOT a status region: it shares this subtree with the
    // problems list, and a skeleton announcing itself would make "loading"
    // compete with the reason a visualization cannot draw.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('degrades a throwing renderer through the error boundary rather than crashing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    function Boom(): never {
      throw new Error('render failure')
    }
    render(
      <VisualizationErrorBoundary>
        <Boom />
      </VisualizationErrorBoundary>
    )
    expect(screen.getByText(/failed to render visualization/i)).toBeInTheDocument()
  })
})
