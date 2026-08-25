import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithProviders, resetStores } from '@/test/utils'
import { SchemaBrowser } from './schema-browser'
import type { SchemaTable } from '@/lib/mock-data'

const HOSTILE: SchemaTable = {
  // A name no statement can carry unquoted. It reaches here from the schema
  // endpoint, which is a backend response, not a constant.
  name: 'trips; DROP TABLE users --',
  columns: [{ name: 'id', type: 'String' }],
}

const SCHEMA: SchemaTable[] = [
  {
    name: 'historical.stations',
    columns: [
      { name: 'station_id', type: 'String' },
      { name: 'captured_at', type: 'DateTime64(3)' },
      { name: 'num_bikes_available', type: 'UInt16' },
    ],
  },
  { name: 'historical.trips', columns: [{ name: 'trip_id', type: 'String' }] },
]

function renderBrowser(onInsert = vi.fn()) {
  renderWithProviders(<SchemaBrowser schema={SCHEMA} dataSourceId={1} onInsert={onInsert} />)
  return onInsert
}

describe('SchemaBrowser', () => {
  beforeEach(resetStores)

  it('refuses to preview a table whose name cannot be written unquoted', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <SchemaBrowser schema={[HOSTILE]} dataSourceId={1} onInsert={vi.fn()} />
    )

    await user.click(screen.getByRole('button', { name: `Preview ${HOSTILE.name}` }))

    const dialog = await screen.findByRole('dialog')
    // Refused, not run: the name is interpolated into the statement, so a name
    // carrying a statement terminator is rejected before anything executes.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/unsafe SQL identifier/i)
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument()
    // And the footer does not rebuild the statement it just refused.
    expect(within(dialog).queryByText(/SELECT \*/)).not.toBeInTheDocument()
  })

  it('previews against the data source the eye was clicked in', async () => {
    const user = userEvent.setup()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Providers({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }
    const { rerender } = render(
      <SchemaBrowser schema={SCHEMA} dataSourceId={1} onInsert={vi.fn()} />,
      { wrapper: Providers }
    )

    await user.click(screen.getByRole('button', { name: 'Preview historical.stations' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByRole('columnheader', { name: 'station_id' })).toBeInTheDocument()
    })

    // The source changes under the open dialog, which is what the page does:
    // an existing query's own source arrives after the first paint.
    rerender(<SchemaBrowser schema={SCHEMA} dataSourceId={2} onInsert={vi.fn()} />)

    // Read off the cache rather than off the grid: both sources return the same
    // columns here, so a second read would look identical on screen while
    // having asked a connection the analyst never pointed at.
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    const previewed = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey)
      // The idle entry the closed dialog holds is keyed on no table at all, and
      // never fetches. Only reads of a real table are the subject here.
      .filter((key) => key[0] === 'table-preview' && key[2] !== '')
    expect(previewed).toEqual([['table-preview', 1, 'historical.stations']])
  })

  // A connector's schema ends with a "Query Examples" pseudo-table whose
  // columns are documentation lines: a rule, a heading, the example, a blank
  // spacer, repeated per resource. Keyed by name, the repeats made React warn
  // about duplicate keys and the blanks drew empty buttons.
  it('lists repeated documentation lines once each and draws no blank ones', async () => {
    const user = userEvent.setup()
    const examples: SchemaTable = {
      name: '__ Query Examples __',
      columns: [
        { name: '─────', type: '' },
        { name: 'EXAMPLE: stops', type: '' },
        { name: '', type: '' },
        { name: '─────', type: '' },
        { name: 'EXAMPLE: carriers', type: '' },
        { name: '', type: '' },
      ],
    }
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderWithProviders(<SchemaBrowser schema={[examples]} dataSourceId={1} onInsert={vi.fn()} />)

    await user.click(screen.getByRole('button', { expanded: false, name: /Query Examples/ }))
    expect(await screen.findAllByText('─────')).toHaveLength(2)
    expect(screen.getByText('EXAMPLE: carriers')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /EXAMPLE|─────/ })).toHaveLength(4)
    expect(warn.mock.calls.map((c) => String(c[0]))).not.toContainEqual(expect.stringMatching(/same key/))
    warn.mockRestore()
  })

  it('expands a table and inserts the names it is clicked on', async () => {
    const user = userEvent.setup()
    const onInsert = renderBrowser()

    // Collapsed: the columns are not in the tree yet.
    expect(screen.queryByText('station_id')).not.toBeInTheDocument()

    await user.click(screen.getByText('historical.stations'))
    // The name inserts rather than expanding, which is the row's own job.
    expect(onInsert).toHaveBeenCalledWith('historical.stations')

    await user.click(screen.getByRole('button', { expanded: false, name: /historical.stations/ }))
    await user.click(await screen.findByText('station_id'))
    expect(onInsert).toHaveBeenCalledWith('station_id')
  })

  it('wires the row trigger to the panel it expands via aria-controls', async () => {
    const user = userEvent.setup()
    renderBrowser()

    // Exact name, not a substring match: a regex here would also catch
    // "Preview historical.stations" and make the query ambiguous.
    const row = screen.getByRole('button', { name: 'historical.stations' })
    // Non-regression: the row is still exposed as a toggle.
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(row).not.toHaveAttribute('aria-controls')

    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')

    // The real gap: the trigger must name the panel it expands, and that
    // panel must actually exist in the document and hold this table's columns.
    const panelId = row.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    const panel = document.getElementById(panelId as string)
    expect(panel).not.toBeNull()
    expect(within(panel as HTMLElement).getByText('station_id')).toBeInTheDocument()
  })

  it('opens a preview of the table the eye is clicked on', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByRole('button', { name: 'Preview historical.stations' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Table preview')).toBeInTheDocument()
    expect(within(dialog).getByText('historical.stations')).toBeInTheDocument()

    // The sample is the table's own columns, not a generic "query ran" row.
    await waitFor(() => {
      expect(within(dialog).getByRole('columnheader', { name: 'station_id' })).toBeInTheDocument()
    })
    expect(within(dialog).getByRole('columnheader', { name: 'num_bikes_available' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('row')).toHaveLength(11) // header + 10 rows
    expect(within(dialog).getByText('10 rows')).toBeInTheDocument()
    expect(within(dialog).getByText(/SELECT \* FROM historical\.stations LIMIT 10/)).toBeInTheDocument()
  })

  it('previews the table whose eye was clicked, not the first one', async () => {
    const user = userEvent.setup()
    renderBrowser()

    await user.click(screen.getByRole('button', { name: 'Preview historical.trips' }))

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByRole('columnheader', { name: 'trip_id' })).toBeInTheDocument()
    })
    expect(within(dialog).queryByRole('columnheader', { name: 'station_id' })).not.toBeInTheDocument()
  })

  it('closes the preview without touching the editor buffer', async () => {
    const user = userEvent.setup()
    const onInsert = renderBrowser()

    await user.click(screen.getByRole('button', { name: 'Preview historical.trips' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onInsert).not.toHaveBeenCalled()
  })
})
