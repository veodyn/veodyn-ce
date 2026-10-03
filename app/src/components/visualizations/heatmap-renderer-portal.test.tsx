import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { VizEnvironmentProvider } from '@/lib/viz-environment'
import { HeatmapRenderer } from './heatmap-renderer'

const visualization: MockVisualization = {
  id: 1,
  type: 'HEATMAP',
  name: 'Portal heatmap',
  description: '',
  options: { columnMapping: { weekday: 'x', period: 'y', count: 'value' } },
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
}

const data: QueryResultData = {
  columns: [
    { name: 'weekday', friendly_name: 'Weekday', type: 'string' },
    { name: 'period', friendly_name: 'Period', type: 'string' },
    { name: 'count', friendly_name: 'Count', type: 'integer' },
  ],
  rows: [{ weekday: 'Monday', period: 'Morning', count: 12 }],
}

describe('the heatmap tooltip portal', () => {
  it('portals into the container a host scope supplies', async () => {
    const user = userEvent.setup()
    const portalContainer = document.createElement('div')
    document.body.appendChild(portalContainer)
    render(
      <VizEnvironmentProvider portalContainer={portalContainer}>
        <HeatmapRenderer visualization={visualization} data={data} />
      </VizEnvironmentProvider>
    )

    await user.hover(screen.getByLabelText('Monday / Morning: 12'))

    expect(portalContainer.querySelector('[role="tooltip"]')).toHaveTextContent('Monday / Morning: 12')
  })

  it('portals into the document body without a host scope', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)

    await user.hover(screen.getByLabelText('Monday / Morning: 12'))

    expect(document.body.querySelector(':scope > [role="tooltip"]')).toHaveTextContent('Monday / Morning: 12')
  })
})
