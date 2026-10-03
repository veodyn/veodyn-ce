import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { PLUGIN_API_VERSION, type VisualizationPlugin, type VisualizationRendererProps } from '../lib/visualizations/plugin'
import { VisualizationRenderer } from '../components/visualizations/visualization-renderer'
import { VeodynProvider } from './veodyn-provider'
import { VeodynViz } from './veodyn-viz'

const BASE = 'https://veodyn.test'
const TOKEN = 'tok-secret-123'
const ROUTE = `${BASE}/api/public/visualizations/${TOKEN}`

function RowCount({ visualization, data }: VisualizationRendererProps) {
  return <p>{`${visualization.name}: ${data.rows.length} rows`}</p>
}

const TEST_PLUGIN: VisualizationPlugin = {
  apiVersion: PLUGIN_API_VERSION,
  type: 'TEST_VV_ROWS',
  displayName: 'Rows',
  icon: () => null,
  defaultOptions: {},
  Renderer: RowCount,
}
const PLUGINS = [TEST_PLUGIN]

function payload(type: string, rows: number) {
  return {
    visualization: { type, name: 'Ridership', description: '', options: {} },
    data: { columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: Array.from({ length: rows }, (_, n) => ({ n })) },
  }
}

function renderViz(props: Partial<Parameters<typeof VeodynViz>[0]> = {}) {
  return render(
    <VeodynProvider baseUrl={BASE} plugins={PLUGINS}>
      <VeodynViz token={TOKEN} {...props} />
    </VeodynProvider>
  )
}

afterEach(() => vi.useRealTimers())

describe('VeodynViz', () => {
  it('renders the shared visualization from the token route', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json(payload('TEST_VV_ROWS', 3))))

    renderViz()

    expect(await screen.findByText('Ridership: 3 rows')).toBeInTheDocument()
  })

  it('sends no credentials with the request', async () => {
    let credentials: RequestCredentials | undefined
    server.use(
      http.get(ROUTE, ({ request }) => {
        credentials = request.credentials
        return HttpResponse.json(payload('TEST_VV_ROWS', 1))
      })
    )

    renderViz()

    await screen.findByText('Ridership: 1 rows')
    expect(credentials).toBe('omit')
  })

  it('shows a loading slot until the payload arrives', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json(payload('TEST_VV_ROWS', 1))))

    renderViz({ renderLoading: () => <p>loading now</p> })

    expect(screen.getByText('loading now')).toBeInTheDocument()
    expect(await screen.findByText('Ridership: 1 rows')).toBeInTheDocument()
  })

  it('says a refused token is no longer available, without naming the token', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json({ error: 'nope' }, { status: 404 })))

    const { container } = renderViz()

    expect(await screen.findByText('This visualization is no longer available.')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain(TOKEN)
  })

  it('uses a host unavailable slot when given one', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json({ error: 'nope' }, { status: 404 })))

    renderViz({ renderUnavailable: () => <p>gone</p> })

    expect(await screen.findByText('gone')).toBeInTheDocument()
  })

  it('names an unregistered type instead of rendering nothing', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json(payload('PACK_ONLY_TYPE', 1))))

    renderViz()

    expect(await screen.findByText(/Unsupported visualization type: PACK_ONLY_TYPE/)).toBeInTheDocument()
  })

  it('flips to unavailable on the next poll after the token is revoked', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    server.use(
      http.get(ROUTE, () => {
        calls += 1
        return calls === 1 ? HttpResponse.json(payload('TEST_VV_ROWS', 2)) : HttpResponse.json({}, { status: 404 })
      })
    )

    renderViz({ refreshSeconds: 15 })
    await screen.findByText('Ridership: 2 rows')
    await act(() => vi.advanceTimersByTimeAsync(15_000))

    await waitFor(() => expect(screen.getByText('This visualization is no longer available.')).toBeInTheDocument())
  })

  it('keeps the last good render when a poll fails outright', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    server.use(
      http.get(ROUTE, () => {
        calls += 1
        return calls === 1 ? HttpResponse.json(payload('TEST_VV_ROWS', 2)) : HttpResponse.error()
      })
    )

    renderViz({ refreshSeconds: 15 })
    await screen.findByText('Ridership: 2 rows')
    await act(() => vi.advanceTimersByTimeAsync(15_000))

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('Ridership: 2 rows')).toBeInTheDocument()
  })

  it.each([502, 503, 429])('keeps the last good render when a poll answers %i', async (status) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let calls = 0
    server.use(
      http.get(ROUTE, () => {
        calls += 1
        return calls === 1 ? HttpResponse.json(payload('TEST_VV_ROWS', 2)) : HttpResponse.json({}, { status })
      })
    )

    renderViz({ refreshSeconds: 15 })
    await screen.findByText('Ridership: 2 rows')
    await act(() => vi.advanceTimersByTimeAsync(15_000))

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('Ridership: 2 rows')).toBeInTheDocument()
  })

  it('shows the unavailable panel when the very first fetch hits an outage', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json({}, { status: 503 })))

    renderViz()

    expect(await screen.findByText('This visualization is no longer available.')).toBeInTheDocument()
  })

  it('names an unregistered type even when the payload carries no result', async () => {
    server.use(
      http.get(ROUTE, () =>
        HttpResponse.json({ visualization: { type: 'PACK_IMAGE_PANEL', name: 'Camera', description: '', options: {} }, data: null })
      )
    )

    renderViz()

    expect(await screen.findByText(/Unsupported visualization type: PACK_IMAGE_PANEL/)).toBeInTheDocument()
  })

  it('exposes a root part and takes the host sizing', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json(payload('TEST_VV_ROWS', 1))))

    const { container } = renderViz({ className: 'h-96', style: { height: 300 } })

    await screen.findByText('Ridership: 1 rows')
    const root = container.querySelector('[data-veodyn-part="root"]')
    expect(root).toHaveClass('h-96')
    expect(root).toHaveStyle({ height: '300px' })
  })

  it('turns a host height into the height charts fill', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json(payload('TEST_VV_ROWS', 1))))

    const { container } = renderViz({ style: { height: 300 } })

    await screen.findByText('Ridership: 1 rows')
    const root = container.querySelector<HTMLElement>('[data-veodyn-part="root"]')
    expect(root?.style.getPropertyValue('--chart-frame-fill')).toBe('300px')
  })

  it('leaves the fill height alone when the host sizes the widget another way', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.json(payload('TEST_VV_ROWS', 1))))

    const { container } = renderViz({ className: 'h-96' })

    await screen.findByText('Ridership: 1 rows')
    const root = container.querySelector<HTMLElement>('[data-veodyn-part="root"]')
    expect(root?.style.getPropertyValue('--chart-frame-fill')).toBe('')
  })

  it('refuses to render outside a provider, saying why', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<VeodynViz token={TOKEN} />)).toThrow(/inside a VeodynProvider/)
  })

  it('lets a fetch-free renderer use a plugin passed only to the provider on its first render', () => {
    render(
      <VeodynProvider baseUrl={BASE} plugins={[{ ...TEST_PLUGIN, type: 'TEST_VV_SERVER' }]}>
        <VisualizationRenderer
          visualization={{ id: 0, type: 'TEST_VV_SERVER', name: 'Server', description: '', options: {}, created_at: '', updated_at: '' }}
          data={{ columns: [], rows: [] }}
        />
      </VeodynProvider>
    )

    expect(screen.queryByText(/Unsupported visualization type/)).not.toBeInTheDocument()
  })
})
