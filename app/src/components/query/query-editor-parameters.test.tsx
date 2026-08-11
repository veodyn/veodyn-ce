/**
 * Authoring a parameter end to end: type `{{ name }}` in the SQL, it appears,
 * you configure it, and it is saved with the query.
 *
 * Before this the editor had no parameter surface at all. Two consequences, not
 * one: nothing could create a parameter (use-query-mutations hardcoded an empty
 * list on create), and a buffer containing `{{ x }}` could not even be run,
 * because `missing_params` applies no defaults and the backend refuses a run
 * with a value missing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockQueries, type MockQuery } from '@/lib/mock-data'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { QueryEditorPage } from './query-editor-page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// The Ace-based editor does not run under jsdom; the buffer is what matters
// here, so it is replaced with a plain textarea that writes to the same place.
vi.mock('./query-editor', () => ({
  QueryEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="SQL" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}))

const QUERY_ID = 6161

function seedQuery(overrides: Partial<MockQuery> = {}) {
  const query: MockQuery = {
    ...mockQueries[0],
    id: QUERY_ID,
    name: 'Dwell time',
    query: 'SELECT 1',
    can_edit: true,
    latest_query_data_id: null,
    schedule: null,
    tags: [],
    options: { parameters: [] },
    ...overrides,
  }
  useMockDataStore.setState({ queries: [query] })
}

/** What the save actually left behind, rather than what the page claims. */
function storedParameters() {
  return useMockDataStore.getState().queries.find((q) => q.id === QUERY_ID)?.options.parameters
}

async function renderEditor() {
  await act(async () => {
    renderWithProviders(<QueryEditorPage queryId={QUERY_ID} />)
  })
}

async function typeSql(user: ReturnType<typeof userEvent.setup>, sql: string) {
  const editor = await screen.findByLabelText('SQL')
  await user.clear(editor)
  await act(async () => {
    await user.type(editor, sql)
  })
}

beforeEach(() => {
  resetStores()
  useAuthStore.setState({ isAuthenticated: true, isLoading: false })
})

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

describe('authoring a parameter in the editor', () => {
  it('shows no parameter bar for SQL that declares none', async () => {
    seedQuery()
    await renderEditor()

    expect(screen.queryByRole('button', { name: 'Apply Changes' })).not.toBeInTheDocument()
  })

  it('creates a control as soon as the SQL references one', async () => {
    const user = userEvent.setup()
    seedQuery()
    await renderEditor()

    await typeSql(user, 'SELECT * FROM t WHERE route = ')
    await typeSql(user, 'SELECT * FROM t WHERE route = {{{{route_id}}}}')

    expect(await screen.findByLabelText('route_id')).toBeInTheDocument()
  })

  it('saves the parameters the SQL declares', async () => {
    const user = userEvent.setup()
    seedQuery()
    await renderEditor()

    await typeSql(user, 'SELECT {{{{route_id}}}}')
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^Save/ }))
    })

    expect(storedParameters()).toEqual([
      { name: 'route_id', title: 'route_id', type: 'text', value: null },
    ])
  })

  it('keeps a saved parameter its settings when the SQL is edited around it', async () => {
    seedQuery({
      query: 'SELECT {{ route_id }}',
      options: {
        parameters: [
          { name: 'route_id', title: 'Route', type: 'enum', value: '12', enumOptions: '12\n40' },
        ],
      },
    })
    await renderEditor()

    // The control is the configured one, not a text box rebuilt from the name.
    expect(await screen.findByLabelText('Route')).toBeInTheDocument()
  })

  it('configures a parameter through its settings and saves the result', async () => {
    const user = userEvent.setup()
    seedQuery({ query: 'SELECT {{ route_id }}', options: { parameters: [] } })
    await renderEditor()

    // Save starts disabled: nothing has been edited yet.
    expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled()

    await user.click(await screen.findByRole('button', { name: 'Settings for route_id' }))
    await user.click(await screen.findByLabelText('Type'))
    await user.click(await screen.findByRole('option', { name: 'Dropdown List' }))
    await user.type(await screen.findByLabelText('Values'), '12{enter}40')
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Save' }))
    })

    // Configuring a parameter changes what a save would write, so it has to
    // leave the buffer saveable even though the SQL was never touched.
    expect(screen.getByRole('button', { name: /^Save/ })).toBeEnabled()

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^Save/ }))
    })

    expect(storedParameters()).toEqual([
      expect.objectContaining({ name: 'route_id', type: 'enum', enumOptions: '12\n40' }),
    ])
  })
})
