import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DraftView } from '@/lib/chat/thread-model'
import type { QueryResultData } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'
import { DraftCard } from './draft-card'
import { chatVisualization } from './result-view'

const DATA: QueryResultData = {
  columns: [
    { name: 'day', friendly_name: 'day', type: 'string' },
    { name: 'trips', friendly_name: 'trips', type: 'integer' },
  ],
  rows: [{ day: 'mon', trips: 3 }],
}

function draft(vizOptions: Record<string, unknown>): DraftView {
  return {
    id: 'd1',
    versions: [
      {
        version: 1,
        payload: {
          name: 'Trips',
          description: '',
          sql: 'select 1',
          dataSourceId: 2,
          vizChoiceId: 'chart-bar',
          vizOptions,
        },
      },
    ],
    promotions: [],
  }
}

describe('chatVisualization with authored options', () => {
  it('merges the sanitized options over the choice preset and drops unknown keys', () => {
    const drawn = chatVisualization('chart-bar', DATA, { columnMapping: { day: 'x', trips: 'y' }, bogus: 1 })
    expect(drawn.options).toMatchObject({ globalSeriesType: 'bar', columnMapping: { day: 'x', trips: 'y' } })
    expect(drawn.options).not.toHaveProperty('bogus')
  })
})

describe('DraftCard authored options', () => {
  it('lists a column the preview result does not have', () => {
    renderWithProviders(
      <DraftCard draft={draft({ columnMapping: { nope: 'y' } })} version={1} data={DATA} selected={false} onSelect={() => undefined} />
    )
    expect(screen.getByRole('alert')).toHaveTextContent('columnMapping: no column named nope')
  })

  it('shows no problem for columns the result has', () => {
    renderWithProviders(
      <DraftCard draft={draft({ columnMapping: { day: 'x', trips: 'y' } })} version={1} data={DATA} selected={false} onSelect={() => undefined} />
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
