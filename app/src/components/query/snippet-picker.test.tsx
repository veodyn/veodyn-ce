/**
 * Inserting a saved snippet into the editor.
 *
 * The snippets page and its CRUD have always existed; nothing could put one in
 * a query. Redash inserts them through Ace's autocomplete on the snippet's
 * trigger word. This is a list you click instead, which the same buffer seam
 * the schema browser already uses can carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQuerySnippets, type MockQuerySnippet } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { SnippetPicker } from './snippet-picker'

const SNIPPETS: MockQuerySnippet[] = [
  {
    id: 1,
    trigger: 'last7d',
    description: 'Last seven days',
    snippet: "timestamp >= now() - interval '7 day'",
    user: { id: 1, name: 'Admin' },
    created_at: '',
    updated_at: '',
  },
  {
    id: 2,
    trigger: 'peak',
    description: 'Peak hours only',
    snippet: 'toHour(timestamp) BETWEEN 7 AND 9',
    user: { id: 1, name: 'Admin' },
    created_at: '',
    updated_at: '',
  },
]

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({ querySnippets: SNIPPETS })
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ querySnippets: mockQuerySnippets })
})

// The panel only exists on an instance that has the surface switched on, and
// the neutral config has it off, so every case about its contents says so.
function renderSnippets(ui: React.ReactElement) {
  return renderWithProviders(ui, {
    config: { features: { query_snippets: true, query_drafts: false } },
  })
}

describe('the snippet picker', () => {
  // The route is a server gate that 404s when the flag is off, so a panel that
  // rendered regardless advertised a page the instance does not serve and a
  // list nothing could ever fill.
  it('renders nothing on an instance with snippets switched off', () => {
    const { container } = renderWithProviders(<SnippetPicker onInsert={vi.fn()} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText(/no snippets/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /create one/i })).not.toBeInTheDocument()
  })

  it('lists each snippet by its trigger and what it does', async () => {
    renderSnippets(<SnippetPicker onInsert={vi.fn()} />)

    expect(await screen.findByText('last7d')).toBeInTheDocument()
    expect(screen.getByText('Last seven days')).toBeInTheDocument()
    expect(screen.getByText('peak')).toBeInTheDocument()
  })

  // The SQL, not the trigger. Inserting the trigger word would leave the query
  // referencing a shorthand the database has never heard of.
  it('inserts the snippet body rather than its trigger', async () => {
    const user = userEvent.setup()
    const onInsert = vi.fn()
    renderSnippets(<SnippetPicker onInsert={onInsert} />)

    await user.click(await screen.findByRole('button', { name: /last7d/ }))

    expect(onInsert).toHaveBeenCalledWith("timestamp >= now() - interval '7 day'")
  })

  it('says so when there are none, rather than showing an empty panel', async () => {
    useMockDataStore.setState({ querySnippets: [] })
    renderSnippets(<SnippetPicker onInsert={vi.fn()} />)

    expect(await screen.findByText(/no snippets/i)).toBeInTheDocument()
  })
})
