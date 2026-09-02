import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueryResults } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QueryResultTable } from './query-result-table'

afterEach(() => resetStores())

function signIn(permissions: string[]) {
  useAuthStore.setState({
    currentUser: buildCurrentUser({ id: 5, name: 'Analyst', email: 'a@example.com', permissions }),
  })
}

describe('QueryResultTable', () => {
  it('renders result rows and reorders them from a column sort toggle', async () => {
    const user = userEvent.setup()
    const source = mockQueryResults[102].data
    // Two distinct station names from the pack's own fixture, in whichever
    // alphabetical order they happen to sort, rather than one pack's literal
    // strings: the toggle's behaviour under test is the reordering, not what
    // the stations are called.
    const [first, second] = [String(source.rows[0].station), String(source.rows[1].station)].sort() as [
      string,
      string,
    ]
    const data = {
      columns: source.columns,
      rows: [source.rows[1], source.rows[0]],
    }

    renderWithProviders(<QueryResultTable data={data} />)

    expect(screen.getByRole('columnheader', { name: /station/i })).toBeInTheDocument()
    expect(screen.getByText(first)).toBeInTheDocument()
    expect(screen.getByText(second)).toBeInTheDocument()

    await user.click(screen.getByRole('columnheader', { name: /station/i }))

    expect(within(screen.getAllByRole('row')[1]).getByText(first)).toBeInTheDocument()

    await user.click(screen.getByRole('columnheader', { name: /station/i }))

    expect(within(screen.getAllByRole('row')[1]).getByText(second)).toBeInTheDocument()
  })

  // A single-row result is the normal shape for an aggregate, not an edge case,
  // so "1 rows" is what most `select count(*)` screens in this product read.
  it('counts one row in the singular', () => {
    const source = mockQueryResults[102].data

    renderWithProviders(<QueryResultTable data={{ columns: source.columns, rows: [source.rows[0]] }} />)

    expect(screen.getByText('1 row')).toBeInTheDocument()
  })

  it('counts several rows in the plural', () => {
    const source = mockQueryResults[102].data

    renderWithProviders(<QueryResultTable data={source} />)

    expect(screen.getByText(`${source.rows.length} rows`)).toBeInTheDocument()
  })

  it('renders through the table primitive', () => {
    const source = mockQueryResults[102].data
    renderWithProviders(<QueryResultTable data={source} />)

    expect(screen.getByRole('table')).toHaveAttribute('data-slot', 'table')
  })

  it('offers the download menu to a user who is not denied export', async () => {
    const user = userEvent.setup()
    signIn(['view_query', 'execute_query'])

    renderWithProviders(<QueryResultTable data={mockQueryResults[102].data} />)

    const trigger = screen.getByRole('button', { name: /download/i })
    await user.click(trigger)

    expect(await screen.findByRole('menuitem', { name: 'CSV' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'TSV' })).toBeInTheDocument()
  })

  it('draws no download control for a group carrying no_export_data', () => {
    signIn(['view_query', 'no_export_data'])

    renderWithProviders(<QueryResultTable data={mockQueryResults[102].data} />)

    // The rows still render: this hides the sanctioned export path, it does not
    // withhold the data, and the test says so rather than implying otherwise.
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
  })

  it('draws no download control for an anonymous reader', () => {
    renderWithProviders(<QueryResultTable data={mockQueryResults[102].data} />, {
      authenticated: false,
    })

    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
  })
})

describe('QueryResultTable column drag', () => {
  const data = {
    columns: [
      { name: 'carrier_code', friendly_name: 'carrier_code', type: 'string' },
      { name: 'stop_id', friendly_name: 'stop_id', type: 'string' },
      { name: 'uuid', friendly_name: 'uuid', type: 'string' },
    ],
    rows: [{ carrier_code: 'MT', stop_id: '1', uuid: 'abc' }],
  }

  it('saves the new order when one header is dropped on another', () => {
    const onColumnsChange = vi.fn()

    renderWithProviders(<QueryResultTable data={data} onColumnsChange={onColumnsChange} />)

    const headers = screen.getAllByRole('columnheader')
    fireEvent.dragStart(headers[2])
    fireEvent.dragOver(headers[0])
    fireEvent.drop(headers[0])

    expect(onColumnsChange).toHaveBeenCalledWith([
      { name: 'uuid', visible: true, order: 0 },
      { name: 'carrier_code', visible: true, order: 1 },
      { name: 'stop_id', visible: true, order: 2 },
    ])
  })

  it('keeps a hidden column and its settings across a reorder', () => {
    const onColumnsChange = vi.fn()
    const columns = [
      { name: 'carrier_code', order: 0, visible: true },
      { name: 'stop_id', order: 1, visible: false },
      { name: 'uuid', order: 2, visible: true, title: 'UUID' },
    ]

    renderWithProviders(
      <QueryResultTable data={data} columns={columns} onColumnsChange={onColumnsChange} />
    )

    const headers = screen.getAllByRole('columnheader')
    fireEvent.dragStart(headers[1])
    fireEvent.dragOver(headers[0])
    fireEvent.drop(headers[0])

    expect(onColumnsChange).toHaveBeenCalledWith([
      { name: 'uuid', order: 0, visible: true, title: 'UUID' },
      { name: 'carrier_code', order: 1, visible: true },
      { name: 'stop_id', order: 2, visible: false },
    ])
  })

  it('leaves headers undraggable where the order has nowhere to be saved', () => {
    renderWithProviders(<QueryResultTable data={data} />)

    expect(screen.getAllByRole('columnheader')[0]).not.toHaveAttribute('draggable', 'true')
  })
})
