import { beforeEach, describe, expect, it } from 'vitest'
import { render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { QueryResultTable } from '@/components/query/query-result-table'
import { buildCurrentUser } from '@/stores/auth-identity'
import { useAuthStore } from '@/stores/auth-store'
import { resetStores } from '@/test/utils'
import { useVizFormats } from '@/lib/viz-formats'
import { useAppResultDownloads, VizAppContext } from './viz-app-context'

function signIn(permissions: string[]) {
  useAuthStore.setState({
    isAuthenticated: true,
    currentUser: buildCurrentUser({ id: 1, name: 'Analyst', email: 'analyst@example.com', permissions }),
  })
}

beforeEach(() => resetStores())

describe('useAppResultDownloads', () => {
  it('grants csv, tsv and the backend xlsx export to a user who may export a saved query', () => {
    signIn(['view_query'])

    const { result } = renderHook(() => useAppResultDownloads(8))

    expect(result.current).toEqual({ csv: true, tsv: true, xlsxHref: '/api/node/queries/8/results.xlsx' })
  })

  it('grants no xlsx export without a saved query', () => {
    signIn(['view_query'])

    const { result } = renderHook(() => useAppResultDownloads())

    expect(result.current).toEqual({ csv: true, tsv: true })
  })

  it('grants nothing to a user barred from exporting', () => {
    signIn(['view_query', 'no_export_data'])

    const { result } = renderHook(() => useAppResultDownloads(8))

    expect(result.current).toBeUndefined()
  })

  it('grants nothing to an anonymous reader', () => {
    const { result } = renderHook(() => useAppResultDownloads(8))

    expect(result.current).toBeUndefined()
  })
})

describe('VizAppContext', () => {
  const data = { columns: [{ name: 'route', friendly_name: 'route', type: 'string' }], rows: [{ route: '12' }] }

  function renderTable() {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <VizAppContext>
          <QueryResultTable data={data} />
        </VizAppContext>
      </QueryClientProvider>
    )
  }

  it('gives a dashboard table the downloads its reader may use', () => {
    signIn(['view_query'])

    renderTable()

    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument()
  })

  it('gives a dashboard table nothing when its reader may not export', () => {
    signIn(['view_query', 'no_export_data'])

    renderTable()

    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument()
  })
})

describe('VizAppContext formats', () => {
  function formatsUnder(client: QueryClient) {
    return renderHook(() => useVizFormats(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <VizAppContext>{children}</VizAppContext>
        </QueryClientProvider>
      ),
    })
  }

  it('gives visualizations the organization date pattern for a signed-in reader', () => {
    signIn(['view_query'])
    const client = new QueryClient()
    client.setQueryData(['org-settings'], { date_format: 'YYYY/MM/DD' })

    const { result } = formatsUnder(client)

    expect(result.current.dateFormat).toBe('YYYY/MM/DD')
  })

  it('never asks for organization settings on behalf of an anonymous reader', () => {
    const client = new QueryClient()

    formatsUnder(client)

    expect(client.getQueryCache().find({ queryKey: ['org-settings'] })?.state.fetchStatus ?? 'idle').toBe('idle')
    expect(client.getQueryData(['org-settings'])).toBeUndefined()
  })
})
