import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { PLUGIN_API_VERSION, type VisualizationPlugin, type VisualizationRendererProps } from '../lib/visualizations/plugin'
import { VeodynProvider } from './veodyn-provider'
import { VeodynViz, type VeodynVizProps } from './veodyn-viz'

const BASE = 'https://veodyn.test'
const ROUTE = `${BASE}/api/public/visualizations/tok`

function Stamp({ visualization, data, retrievedAt }: VisualizationRendererProps) {
  return <p>{`${visualization.name}: ${data.rows.length} rows at ${retrievedAt ?? 'never'}`}</p>
}

const PLUGINS: VisualizationPlugin[] = [
  { apiVersion: PLUGIN_API_VERSION, type: 'TEST_VP_STAMP', displayName: 'Stamp', icon: () => null, defaultOptions: {}, Renderer: Stamp },
]

function body(name: string, extra: Record<string, unknown> = {}, rows = 1) {
  return {
    visualization: { type: 'TEST_VP_STAMP', name, description: '', options: {} },
    data: { columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: Array.from({ length: rows }, (_, n) => ({ n })) },
    ...extra,
  }
}

const PENDING = { ...body('Route'), data: null, status: 'pending' }

function pendingResponse(seconds = '1') {
  return HttpResponse.json(PENDING, { status: 202, headers: { 'Retry-After': seconds } })
}

function renderViz(props: Partial<VeodynVizProps> = {}, client?: QueryClient) {
  const tree = (next: Partial<VeodynVizProps>) => (
    <VeodynProvider baseUrl={BASE} plugins={PLUGINS} queryClient={client}>
      <VeodynViz token="tok" {...props} {...next} />
    </VeodynProvider>
  )
  const view = render(tree({}))
  return { ...view, setProps: (next: Partial<VeodynVizProps>) => view.rerender(tree(next)) }
}

function recordSearches(respond: (search: URLSearchParams, calls: number) => Response) {
  const searches: string[] = []
  server.use(
    http.get(ROUTE, ({ request }) => {
      const url = new URL(request.url)
      searches.push(url.search)
      return respond(url.searchParams, searches.length)
    })
  )
  return searches
}

afterEach(() => vi.useRealTimers())

describe('VeodynViz parameters', () => {
  it('sends p_ keys sorted by key', async () => {
    const searches = recordSearches(() => HttpResponse.json(body('Route')))

    renderViz({ parameters: { route: 'MT020', a: 2 } })

    expect(await screen.findByText(/Route: 1 rows/)).toBeInTheDocument()
    expect(searches).toEqual(['?p_a=2&p_route=MT020'])
  })

  it('sends no query string without parameters', async () => {
    const searches = recordSearches(() => HttpResponse.json(body('Route')))

    renderViz()

    await screen.findByText(/Route: 1 rows/)
    expect(searches).toEqual([''])
  })

  it('passes retrievedAt from the payload to the renderer', async () => {
    recordSearches(() => HttpResponse.json(body('Route', { retrievedAt: '2026-10-08T10:00:00Z' })))

    renderViz({ parameters: { route: 'MT020' } })

    expect(await screen.findByText('Route: 1 rows at 2026-10-08T10:00:00Z')).toBeInTheDocument()
  })

  it('keeps two parameter sets in two cache entries', async () => {
    const client = new QueryClient()
    const searches = recordSearches((search) => HttpResponse.json(body(`R-${search.get('p_route')}`)))

    const { setProps } = renderViz({ parameters: { route: 'A' } }, client)
    await screen.findByText(/R-A: 1 rows/)
    setProps({ parameters: { route: 'B' } })
    await screen.findByText(/R-B: 1 rows/)
    setProps({ parameters: { route: 'A' } })

    expect(await screen.findByText(/R-A: 1 rows/)).toBeInTheDocument()
    expect(client.getQueryCache().findAll().map((q) => q.queryKey)).toHaveLength(2)
    expect(searches.slice(0, 2)).toEqual(['?p_route=A', '?p_route=B'])
  })

  it('shows the loading slot for pending with no data, then renders once fresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const searches = recordSearches((_s, calls) =>
      calls === 1 ? pendingResponse('2') : HttpResponse.json(body('Route', { status: 'fresh' }))
    )

    renderViz({ parameters: { route: 'MT020' }, renderLoading: () => <p>loading now</p> })

    expect(await screen.findByText('loading now')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1900))
    expect(searches).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(200))

    expect(await screen.findByText(/Route: 1 rows/)).toBeInTheDocument()
    expect(searches).toHaveLength(2)
  })

  it('shows the unavailable slot for unavailable with no data', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    recordSearches(() =>
      HttpResponse.json({ ...PENDING, status: 'unavailable' }, { status: 503, headers: { 'Retry-After': '30' } })
    )

    renderViz({ parameters: { route: 'MT020' }, renderUnavailable: () => <p>gone</p> })

    expect(await screen.findByText('gone')).toBeInTheDocument()
  })

  it('renders a payload with data whatever its status', async () => {
    recordSearches(() => HttpResponse.json(body('Route', { status: 'stale' }), { status: 200 }))

    renderViz({ parameters: { route: 'MT020' }, renderUnavailable: () => <p>gone</p> })

    expect(await screen.findByText(/Route: 1 rows/)).toBeInTheDocument()
  })

  it('stops retrying every Retry-After after 10 and falls back to 30 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const searches = recordSearches(() => pendingResponse('1'))

    renderViz({ parameters: { route: 'MT020' } })
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    expect(searches).toHaveLength(11)

    await act(() => vi.advanceTimersByTimeAsync(28_000))
    expect(searches).toHaveLength(11)
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(searches).toHaveLength(12)
  })

  it('uses the larger of refreshSeconds and 30 seconds after the cap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const searches = recordSearches(() => pendingResponse('1'))

    renderViz({ parameters: { route: 'MT020' }, refreshSeconds: 60 })
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    await act(() => vi.advanceTimersByTimeAsync(40_000))
    expect(searches).toHaveLength(11)
    await act(() => vi.advanceTimersByTimeAsync(21_000))
    expect(searches).toHaveLength(12)
  })

  it('starts the retry count again when the parameters change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const searches = recordSearches(() => pendingResponse('1'))

    const { setProps } = renderViz({ parameters: { route: 'A' } })
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    expect(searches).toHaveLength(11)

    setProps({ parameters: { route: 'B' } })
    await act(() => vi.advanceTimersByTimeAsync(3_500))

    expect(searches.filter((s) => s === '?p_route=B').length).toBeGreaterThanOrEqual(4)
  })
})
