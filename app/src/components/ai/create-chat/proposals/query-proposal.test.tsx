// The card tests all follow the same shape: drive the real hooks against the
// mock store, then assert on the object that was actually stored. An edit that
// only lives in the card's own state and never reaches the write would pass a
// test that asserted on the DOM, and that is the defect these are here to
// catch.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDataSources, mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { QueryProposal } from '@/types/ai-create'
import { QueryProposalCard } from './query-proposal'

const SQL = 'SELECT station, count() AS rides FROM analytics.rail_taps GROUP BY station'

const PROPOSAL: QueryProposal = {
  kind: 'query',
  name: 'Rides by station',
  description: 'Tap counts per rail station',
  sql: SQL,
  datasetTable: 'analytics.rail_taps',
  vizChoiceId: 'table',
  vizOptions: {},
}

// The same proposal as a chart the service mapped for itself, which is the only
// case where its options are worth anything: a table reads no mapping.
const MAPPED: QueryProposal = {
  ...PROPOSAL,
  vizChoiceId: 'chart-line',
  vizOptions: { columnMapping: { station: 'x', rides: 'y' }, legend: { enabled: false } },
}

function renderCard(onCreated = vi.fn(), onBusyChange = vi.fn(), proposal = PROPOSAL) {
  const result = renderWithProviders(
    <QueryProposalCard
      proposal={proposal}
      onCreated={onCreated}
      onBusyChange={onBusyChange}
    />
  )
  return { ...result, onCreated, onBusyChange }
}

/** The visualizations stored for a query, by the name it was created under. */
function storedVisualizations(name: string) {
  return storedQuery(name)?.visualizations ?? []
}

function storedQuery(name: string) {
  return useMockDataStore.getState().queries.find((query) => query.name === name)
}

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({
    queries: mockQueries.map((query) => ({ ...query })),
    dataSources: mockDataSources.map((source) => ({ ...source })),
  })
})

describe('QueryProposalCard', () => {
  it('adds no second Table visualization, because every new query already has one', async () => {
    const user = userEvent.setup()
    renderCard()

    // The proposal's own choice is the table, which is the default a proposal
    // lands on. Creating a visualization for it gives the editor two identical
    // Table tabs, on the most common path through this card.
    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(storedQuery(PROPOSAL.name)).toBeDefined())
    const created = storedQuery(PROPOSAL.name)
    expect(created?.visualizations.map((viz) => viz.type)).toEqual(['TABLE'])
  })

  it('writes the edited name, description, data source and chart, not the proposed ones', async () => {
    const user = userEvent.setup()
    const { onCreated } = renderCard()

    const name = screen.getByLabelText('Query name')
    await user.clear(name)
    await user.type(name, 'Rail taps by station')
    const description = screen.getByLabelText('Description')
    await user.clear(description)
    await user.type(description, 'Edited before creating')

    await user.click(screen.getByRole('combobox', { name: 'Visualization' }))
    await user.click(await screen.findByRole('option', { name: 'Bar' }))

    // The proposal carries no data source, so the browser resolves one. The
    // default is ClickHouse (id 1); this picks the Postgres source instead.
    const postgresDataSourceName = mockDataSources.find((d) => d.id === 2)?.name ?? ''
    await user.click(screen.getByRole('combobox', { name: 'Data source' }))
    await user.click(await screen.findByRole('option', { name: postgresDataSourceName }))

    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(storedQuery('Rail taps by station')).toBeDefined())
    const stored = storedQuery('Rail taps by station')
    expect(storedQuery('Rides by station')).toBeUndefined()
    expect(stored?.description).toBe('Edited before creating')
    expect(stored?.data_source_id).toBe(2)
    // Byte-identical to what the validator passed.
    expect(stored?.query).toBe(SQL)
    // The chart shape is an option on a CHART visualization, not a type.
    await waitFor(() =>
      expect(
        storedQuery('Rail taps by station')?.visualizations.some(
          (viz) => viz.type === 'CHART' && viz.options.globalSeriesType === 'bar'
        )
      ).toBe(true)
    )
    expect(onCreated).toHaveBeenCalledWith(`/queries/${stored?.id}`)
  })

  it('draws the chart with the mapping the service chose', async () => {
    // The service authored these against the statement's real result columns.
    // Dropping them leaves the renderer guessing from column order, which is
    // what every AI-authored chart did before.
    const user = userEvent.setup()
    renderCard(vi.fn(), vi.fn(), MAPPED)

    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(storedVisualizations(MAPPED.name)).toHaveLength(2))
    expect(storedVisualizations(MAPPED.name)[1]).toMatchObject({
      type: 'CHART',
      options: {
        globalSeriesType: 'line',
        columnMapping: { station: 'x', rides: 'y' },
        legend: { enabled: false },
      },
    })
  })

  it('keeps those options when the analyst picks another shape of the same type', async () => {
    // Line to bar is a change of `globalSeriesType` on the same CHART, so the
    // mapping still describes exactly the visualization being saved.
    const user = userEvent.setup()
    renderCard(vi.fn(), vi.fn(), MAPPED)

    await user.click(screen.getByRole('combobox', { name: 'Visualization' }))
    await user.click(await screen.findByRole('option', { name: 'Bar' }))
    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(storedVisualizations(MAPPED.name)).toHaveLength(2))
    expect(storedVisualizations(MAPPED.name)[1]).toMatchObject({
      type: 'CHART',
      options: { globalSeriesType: 'bar', columnMapping: { station: 'x', rides: 'y' } },
    })
  })

  it('drops those options when the analyst picks a different kind of visualization', async () => {
    // The options describe a CHART. Keeping them on a COUNTER would hand the
    // renderer a columnMapping it does not read and a legend that means nothing.
    const user = userEvent.setup()
    renderCard(vi.fn(), vi.fn(), MAPPED)

    await user.click(screen.getByRole('combobox', { name: 'Visualization' }))
    await user.click(await screen.findByRole('option', { name: 'Counter' }))
    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(storedVisualizations(MAPPED.name)).toHaveLength(2))
    const stored = storedVisualizations(MAPPED.name)[1]
    expect(stored.type).toBe('COUNTER')
    expect(stored.options).toEqual({})
  })

  it('defaults to the ClickHouse data source when the user picks nothing', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(storedQuery('Rides by station')).toBeDefined())
    expect(storedQuery('Rides by station')?.data_source_id).toBe(1)
  })

  it('shows the generated SQL without offering a way to edit it', () => {
    renderCard()

    expect(screen.getByLabelText('Generated SQL')).toHaveTextContent('rail_taps')
    // No field holds the SQL: editing it here would write a statement the
    // server-side validator never saw.
    expect(screen.queryByDisplayValue(SQL)).toBeNull()
    expect(
      screen.getAllByRole('textbox').some((field) => (field as HTMLInputElement).value === SQL)
    ).toBe(false)
  })

  it('keeps the proposal and its edits when the create is rejected', async () => {
    const user = userEvent.setup()
    // Replacing the store action is the mock-mode equivalent of a backend
    // refusing the write.
    useMockDataStore.setState({
      addQuery: () => {
        throw new Error('Backend said 503')
      },
    })
    const { onCreated, onBusyChange } = renderCard()

    const name = screen.getByLabelText('Query name')
    await user.clear(name)
    await user.type(name, 'Rail taps by station')
    await user.click(screen.getByRole('button', { name: 'Create query' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not create this query. Backend said 503'
    )
    // Nothing partial is left behind, the edit survives, and the shell is told
    // it can unlock its composer again.
    expect(screen.getByLabelText('Query name')).toHaveValue('Rail taps by station')
    expect(onCreated).not.toHaveBeenCalled()
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
    expect(useMockDataStore.getState().queries).toHaveLength(mockQueries.length)
  })

  it('tells the shell when a create is in flight and when it is over', async () => {
    const user = userEvent.setup()
    const { onBusyChange } = renderCard()

    await user.click(screen.getByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false))
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
  })
})
