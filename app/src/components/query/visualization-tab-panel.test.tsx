import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import type { MockVisualization } from '@/lib/mock-data'
import { VisualizationTabPanel } from './visualization-tab-panel'

const resultData = {
  columns: [
    { name: 'departure_at', friendly_name: 'departure_at', type: 'string' },
    { name: 'gtfs_digest', friendly_name: 'gtfs_digest', type: 'string' },
  ],
  rows: [{ departure_at: '2026-09-02T15:23:50Z', gtfs_digest: '52b2c032' }],
}

function tableViz(options: MockVisualization['options']): MockVisualization {
  return {
    id: 169,
    type: 'TABLE',
    name: 'Departures board',
    description: '',
    options,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('VisualizationTabPanel', () => {
  it('renders a saved table visualization with its own column settings', () => {
    renderWithProviders(
      <VisualizationTabPanel
        viz={tableViz({
          columns: [
            { name: 'departure_at', title: 'Departs', visible: true, order: 0 },
            { name: 'gtfs_digest', visible: false, order: 1 },
          ],
        })}
        resultData={resultData}
        isRunning={false}
        queryId={85}
      />
    )

    expect(screen.getByRole('columnheader', { name: 'Departs' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'gtfs_digest' })).not.toBeInTheDocument()
  })

  it('renders every column when the table carries no column settings', () => {
    renderWithProviders(
      <VisualizationTabPanel viz={tableViz({})} resultData={resultData} isRunning={false} queryId={85} />
    )

    expect(screen.getByRole('columnheader', { name: 'departure_at' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'gtfs_digest' })).toBeInTheDocument()
  })

  it('survives a table whose options the backend stored as null', () => {
    const viz = tableViz(null as unknown as MockVisualization['options'])
    renderWithProviders(<VisualizationTabPanel viz={viz} resultData={resultData} isRunning={false} queryId={85} />)

    expect(screen.getByRole('columnheader', { name: 'gtfs_digest' })).toBeInTheDocument()
  })
})
