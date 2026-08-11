import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderWithProviders } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { Toaster } from '@/components/ui/sonner'
import { mockQueries, type MockVisualization } from '@/lib/mock-data'
import { VisualizationTabs } from './visualization-tabs'

vi.mock('@/components/visualizations/visualization-renderer', () => ({
  VisualizationRenderer: ({ visualization }: { visualization: MockVisualization }) => (
    <div data-testid="viz">{visualization.name}</div>
  ),
}))

vi.mock('./query-result-table', () => ({
  QueryResultTable: () => <div data-testid="viz">table panel</div>,
}))

const chartViz: MockVisualization = {
  id: 1,
  type: 'CHART',
  name: 'Chart View',
  description: '',
  options: { globalSeriesType: 'bar', columnMapping: { a: 'x' } },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const counterViz: MockVisualization = {
  id: 3,
  type: 'COUNTER',
  name: 'Counter View',
  description: '',
  options: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const tableViz: MockVisualization = {
  id: 2,
  type: 'TABLE',
  name: 'Table View',
  description: '',
  options: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const queryResult = {
  data: {
    columns: [{ name: 'a', friendly_name: 'A', type: 'string' }],
    rows: [{ a: 'x' }],
  },
}

// A query the mock backend actually owns, so a create writes somewhere and
// returns a visualization rather than throwing 'Query not found'.
const SAVED_QUERY_ID = 1

function savedVisualizations(): MockVisualization[] {
  const query = useMockDataStore.getState().queries.find((q) => q.id === SAVED_QUERY_ID)
  if (!query) throw new Error(`mock query ${SAVED_QUERY_ID} is missing`)
  return query.visualizations
}

// The parent owns the list and refetches after a create; this stands in for that
// refetch. Bare, and wrapped only on rerender: `rerender` skips the wrapper
// `renderWithProviders` added, so the tree has to keep the same shape either way
// or React remounts the component and the tab selection under test is lost.
function handDown(visualizations: MockVisualization[]) {
  return (
    <VisualizationTabs
      visualizations={visualizations}
      queryResult={queryResult}
      queryId={SAVED_QUERY_ID}
    />
  )
}

afterEach(() => {
  useMockDataStore.setState({ queries: structuredClone(mockQueries) })
})

describe('VisualizationTabs', () => {
  it('wires a tabpanel per visualization and switches on tab click', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, tableViz]} queryResult={queryResult} />
    )

    expect(screen.getByRole('tab', { name: 'Chart View' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Table View' })).toBeInTheDocument()

    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    expect(screen.getByTestId('viz')).toHaveTextContent('Chart View')

    await user.click(screen.getByRole('tab', { name: 'Table View' }))

    expect(screen.getByTestId('viz')).toHaveTextContent('table panel')
  })

  // "How do I edit this chart?" was a fair question: editing lived behind an
  // unlabelled kebab that reads as generic overflow.
  it('offers a named edit control on the active visualization', () => {
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, tableViz]} queryResult={queryResult} queryId={5} />
    )

    expect(screen.getByRole('button', { name: 'Edit Chart View' })).toBeInTheDocument()
  })

  it('opens the editor on a double-click of the tab', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, tableViz]} queryResult={queryResult} queryId={5} />
    )

    await user.dblClick(screen.getByRole('tab', { name: 'Chart View' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  // The editor mounted alongside the tabs with no visualization to edit, so its
  // state initialised to the TABLE default and stayed there: every later open
  // showed "Edit Table" and a table editor, whatever chart you clicked, and
  // saving wrote that default over the chart.
  it('opens the editor on the visualization whose pencil was clicked', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, tableViz]} queryResult={queryResult} queryId={5} />
    )

    await user.click(screen.getByRole('button', { name: 'Edit Chart View' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Edit Chart View')
    expect(screen.getByDisplayValue('Chart View')).toBeInTheDocument()
    // The chart's own editor, not the table editor the default type produced,
    // and loaded with the options already saved on it: those are what Save
    // writes back, so a default here is a chart quietly reconfigured.
    // The editor for a type is loaded on demand, so the dialog is on screen
    // before its controls are.
    await screen.findByText('Chart Type')
    expect(dialog).toHaveTextContent('Chart Type')
    // Second select in the dialog after the visualization type: the chart's own
    // type, which can only read 'bar' from the options it has saved. Those are
    // what Save writes back, so a default here is a chart quietly reconfigured.
    expect(screen.getAllByRole('combobox')[1]).toHaveTextContent('Bar')
  })

  // Opening the editor twice reused the first visit's state, so a name typed
  // into one visualization turned up in the next one you opened.
  it('does not carry state from one editor visit into the next', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, counterViz]} queryResult={queryResult} queryId={5} />
    )

    await user.click(screen.getByRole('button', { name: 'Edit Chart View' }))
    await user.clear(screen.getByDisplayValue('Chart View'))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('tab', { name: 'Counter View' }))
    await user.click(screen.getByRole('button', { name: 'Edit Counter View' }))

    expect(screen.getByDisplayValue('Counter View')).toBeInTheDocument()
  })

  // A table has no options to edit, and without a queryId there is nothing to
  // save against, so neither grows controls.
  it('offers no edit control for a table or an unsaved query', () => {
    const { unmount } = renderWithProviders(
      <VisualizationTabs visualizations={[tableViz]} queryResult={queryResult} queryId={5} />
    )
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    unmount()

    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz]} queryResult={queryResult} />
    )
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
  })

  // Deleting a saved visualization has no undo, and its only friction was that
  // the control sat inside a dropdown.
  it('asks before deleting, naming the visualization', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, tableViz]} queryResult={queryResult} queryId={5} />
    )

    await user.click(screen.getByRole('button', { name: 'More options for Chart View' }))
    await user.click(await screen.findByText('Delete'))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/delete visualization\?/i)
    // Named, so it is clear which one is about to go.
    expect(dialog).toHaveTextContent('Chart View')
    // Asking is not doing: backing out leaves the visualization alone.
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('tab', { name: 'Chart View' })).toBeInTheDocument()
  })

  it('falls back to the first visualization when the active one is removed', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(
      <VisualizationTabs visualizations={[chartViz, tableViz]} queryResult={queryResult} />
    )

    await user.click(screen.getByRole('tab', { name: 'Table View' }))
    expect(screen.getByTestId('viz')).toHaveTextContent('table panel')

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    rerender(
      <QueryClientProvider client={queryClient}>
        <VisualizationTabs visualizations={[chartViz]} queryResult={queryResult} />
      </QueryClientProvider>
    )

    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    expect(screen.getByTestId('viz')).toHaveTextContent('Chart View')
  })

  // Save closed the dialog and nothing else happened: the tab strip kept showing
  // the visualization it was already on, so the chart the analyst had just built
  // was nowhere on screen and Save read as a dead button.
  it('selects the visualization it just created', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithProviders(handDown(savedVisualizations()))

    await user.click(screen.getByRole('button', { name: 'Add visualization' }))
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Fresh Chart')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(savedVisualizations().some((v) => v.name === 'Fresh Chart')).toBe(true)
    )
    // Bare, not withProvider: renderWithProviders supplies the providers as a
    // testing-library `wrapper`, which is reapplied on rerender. Re-wrapping
    // here would nest a second QueryClientProvider inside the first, change the
    // element type at this position, and remount the tab strip, discarding the
    // very selection this test is about.
    rerender(handDown(savedVisualizations()))

    const tab = await screen.findByRole('tab', { name: 'Fresh Chart' })
    expect(tab).toHaveAttribute('aria-selected', 'true')
  })

  // The create had no onError, so a POST the backend refused looked exactly like
  // one it accepted: the dialog closed either way and the tab never appeared.
  it('says so when the visualization could not be created', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <>
        {/* A query the backend does not have, which is how a create fails here. */}
        <VisualizationTabs
          visualizations={[chartViz, tableViz]}
          queryResult={queryResult}
          queryId={9999}
        />
        <Toaster />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'Add visualization' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Scoped to role="alert" (a refusal is assertive) rather than a bare text
    // query: the same message is also painted by the visible toast, so an
    // unscoped query matches twice.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/could not (be )?(create|add)/i)
    )
  })
})
