import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { MockVisualization, QueryResultData } from '../../types/viz-data'
import { renderWithProviders } from '@/test/utils'

vi.mock('./choropleth-renderer', () => ({
  ChoroplethRenderer: ({
    onOptionsChange,
  }: {
    onOptionsChange?: (options: Record<string, unknown>) => void
  }) => (
    <div>
      choropleth-ok
      <button type="button" onClick={() => onOptionsChange?.({ framed: true })}>
        write options
      </button>
    </div>
  ),
}))
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
  ])('routes %s to its renderer', async (type, text) => {
    render(<VisualizationRenderer visualization={viz(type)} data={data} />)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  it('hands the renderer the options callback, when one is given', async () => {
    const onOptionsChange = vi.fn()
    render(
      <VisualizationRenderer
        visualization={viz('CHOROPLETH')}
        data={data}
        onOptionsChange={onOptionsChange}
      />
    )
    ;(await screen.findByRole('button', { name: 'write options' })).click()
    expect(onOptionsChange).toHaveBeenCalledWith({ framed: true })
  })

  it('still shows the muted default for an unknown type', () => {
    render(<VisualizationRenderer visualization={viz('NOPE')} data={data} />)
    expect(screen.getByText(/unsupported visualization type: NOPE/i)).toBeInTheDocument()
  })

  it('says which mapped column is missing instead of drawing a silent blank', () => {
    const bikes: QueryResultData = {
      columns: [{ name: 'name', friendly_name: 'name', type: 'string' }],
      rows: [],
    }
    const chart = { ...viz('CHART'), options: { columnMapping: { capacity: 'y' } } }

    renderWithProviders(<VisualizationRenderer visualization={chart} data={bikes} />)

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
