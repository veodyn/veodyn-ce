import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CallView } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { QueryDetailCard } from './query-detail-card'

function call(overrides: Partial<CallView> = {}, canEdit = true): CallView {
  return {
    callId: 'c1',
    tool: 'open_query',
    status: 'done',
    target: null,
    error: null,
    output: {
      kind: 'query_detail',
      ok: true,
      query: {
        id: 5,
        name: 'Trips by hour',
        description: null,
        sql: 'select {{ day }}',
        dataSourceId: 2,
        parameters: [{ name: 'day', type: 'date' }],
        tags: [],
        schedule: null,
        isDraft: false,
        updatedAt: 'u',
        canEdit,
        visualizations: [],
      },
    },
    ...overrides,
  }
}

describe('QueryDetailCard', () => {
  it('shows the name as a link, the parameter names and that the user can edit', () => {
    renderWithProviders(<QueryDetailCard call={call()} />)
    expect(screen.getByRole('link', { name: 'Trips by hour' })).toHaveAttribute('href', '/queries/5')
    expect(screen.getByText('Parameters: day')).toBeInTheDocument()
    expect(screen.getByText('You can edit this query.')).toBeInTheDocument()
  })

  it('says when the user cannot edit', () => {
    renderWithProviders(<QueryDetailCard call={call({}, false)} />)
    expect(screen.getByText('You cannot edit this query.')).toBeInTheDocument()
  })

  it('shows the failure of a query that could not be opened', () => {
    renderWithProviders(
      <QueryDetailCard
        call={call({ status: 'failed', error: 'No query 5', output: { kind: 'query_detail', ok: false, error: 'No query 5' } })}
      />
    )
    expect(screen.getByText('No query 5')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows progress while the query is being read', () => {
    renderWithProviders(<QueryDetailCard call={call({ status: 'running', output: null })} />)
    expect(screen.getByText('Opening the query…')).toBeInTheDocument()
  })
})
