// Editing a widget's visualization from the dashboard.
//
// The whole point of the control is that it writes to the VISUALIZATION, not to
// the widget, so the assertions here are about the store the query owns rather
// than about the dialog closing. A pencil that opens a modal whose Save does
// nothing is the failure mode worth a test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { mockQueries, mockQueryResults } from '@/lib/mock-data'
import type { MockDashboardWidget, MockQuery, MockQueryResult, MockVisualization } from '@/lib/mock-data'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { VisualizationWidget } from './visualization-widget'

const QUERY_ID = 91001
const DATA_ID = 91002
const VIZ_ID = 91003
const OWNER = { id: 7, name: 'Owner', email: 'owner@example.com' }

const COUNTER: MockVisualization = {
  id: VIZ_ID,
  type: 'COUNTER',
  name: 'Temperature',
  description: '',
  options: { counterColName: 'temp_f', counterLabel: 'Temperature (DTLA)' },
  created_at: '',
  updated_at: '',
}

function seed() {
  const query: MockQuery = {
    id: QUERY_ID,
    name: 'Environment: current weather',
    description: '',
    query: 'select temp_f from weather',
    data_source_id: 1,
    schedule: null,
    tags: [],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    is_safe: true,
    can_edit: true,
    user: OWNER,
    last_modified_by: OWNER,
    // The mock update path rewrites this list, so the visualization has to be
    // on it: a widget pointing at one the query does not list is a fixture that
    // could not exist against Redash.
    visualizations: [COUNTER],
    latest_query_data_id: DATA_ID,
    options: { parameters: [] },
    created_at: '',
    updated_at: '',
    retrieved_at: '',
    runtime: 0,
  }
  const result: MockQueryResult = {
    id: DATA_ID,
    query_hash: 'hash',
    query: query.query,
    data_source_id: 1,
    runtime: 0,
    retrieved_at: '2026-01-01T00:00:00Z',
    data: {
      columns: [{ name: 'temp_f', friendly_name: 'temp_f', type: 'float' }],
      rows: [{ temp_f: 69.87 }],
    },
  }
  useMockDataStore.setState((s) => ({
    queries: [...s.queries, query],
    queryResults: { ...s.queryResults, [DATA_ID]: result },
  }))
}

function widget(queryUser?: { id: number }): MockDashboardWidget {
  return {
    id: 511,
    dashboard_id: 1,
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 2, sizeY: 3 } },
    visualization: {
      ...COUNTER,
      query: { id: QUERY_ID, name: 'Environment: current weather', latest_query_data_id: DATA_ID, user: queryUser },
    },
  }
}

function signIn(user: { id: number; name: string; email: string }, permissions: string[]) {
  useAuthStore.setState({
    currentUser: buildCurrentUser({ ...user, permissions }),
  })
}

beforeEach(() => {
  seed()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetStores()
  useMockDataStore.setState({ queries: [...mockQueries], queryResults: { ...mockQueryResults } })
})

describe('editing a visualization from its widget', () => {
  it('offers the pencil to the owner of the widget’s query', async () => {
    signIn(OWNER, ['edit_query'])

    renderWithProviders(<VisualizationWidget widget={widget(OWNER)} isEditing={false} />)

    // Only once the result has loaded: the dialog it opens is built from the
    // columns, so a pencil beside a widget that is still loading would open a
    // type picker with nothing to configure.
    const pencil = await screen.findByRole('button', { name: 'Edit visualization' })
    expect(pencil).toBeInTheDocument()
  })

  it('does not offer it to a reader who does not own the query', async () => {
    // The gate is admin-or-owner, the same rule as the query editor's. A reader
    // holding the org-wide edit_query permission still does not own this one.
    signIn({ id: 42, name: 'Reader', email: 'reader@example.com' }, ['edit_query'])

    renderWithProviders(<VisualizationWidget widget={widget(OWNER)} isEditing={false} />)

    await screen.findByRole('button', { name: 'Refresh' })
    expect(screen.queryByRole('button', { name: 'Edit visualization' })).not.toBeInTheDocument()
  })

  it('does not offer it when the widget does not say who owns the query', async () => {
    // An absent owner reads as "not mine". The alternative, showing the control
    // and finding out on Save, spends the reader's edit to learn it.
    signIn({ id: 42, name: 'Reader', email: 'reader@example.com' }, ['edit_query'])

    renderWithProviders(<VisualizationWidget widget={widget()} isEditing={false} />)

    await screen.findByRole('button', { name: 'Refresh' })
    expect(screen.queryByRole('button', { name: 'Edit visualization' })).not.toBeInTheDocument()
  })

  it('says whose visualization is being edited, since it is not the dashboard’s', async () => {
    signIn(OWNER, ['edit_query'])

    renderWithProviders(<VisualizationWidget widget={widget(OWNER)} isEditing={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit visualization' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Environment: current weather')
    expect(dialog).toHaveTextContent(/Every dashboard and report showing this visualization/)
  })

  it('writes Save through to the visualization the query owns', async () => {
    signIn(OWNER, ['edit_query'])

    renderWithProviders(<VisualizationWidget widget={widget(OWNER)} isEditing={false} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit visualization' }))
    await screen.findByRole('dialog')
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'Temp now')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const saved = useMockDataStore
        .getState()
        .queries.find((query) => query.id === QUERY_ID)
        ?.visualizations.find((viz) => viz.id === VIZ_ID)
      expect(saved?.name).toBe('Temp now')
    })
  })
})
