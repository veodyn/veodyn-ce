import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { PLUGIN_API_VERSION, type VisualizationPlugin, type VisualizationRendererProps } from '../lib/visualizations/plugin'
import { VeodynProvider } from './veodyn-provider'
import { VeodynDashboard, type VeodynDashboardProps } from './veodyn-dashboard'

const BASE = 'https://veodyn.test'
const TOKEN = 'dash-token-1'
const DASHBOARD = `${BASE}/api/public/dashboards/${TOKEN}`

function RowCount({ visualization, data }: VisualizationRendererProps) {
  return <p>{`${visualization.name}: ${data.rows.map((row) => String(row.stop ?? row.n)).join(',')}`}</p>
}

const PLUGINS: VisualizationPlugin[] = [
  {
    apiVersion: PLUGIN_API_VERSION,
    type: 'TEST_VD_ROWS',
    displayName: 'Rows',
    icon: () => null,
    defaultOptions: {},
    Renderer: RowCount,
  },
]

const DASHBOARD_BODY = {
  name: 'Bridge closure',
  widgets: [
    {
      id: 2,
      position: { col: 2, row: 0, sizeX: 4, sizeY: 6 },
      hideTitle: false,
      text: null,
      visualization: { type: 'TEST_VD_ROWS', name: 'Departures', description: '', options: {} },
      parameters: [{ name: 'stop', title: 'Stop', defaultValue: '80214' }],
    },
    {
      id: 1,
      position: { col: 0, row: 0, sizeX: 2, sizeY: 6 },
      hideTitle: false,
      text: '## Detour\nUse the [Gerald Desmond](https://bridge.test) bridge.',
      visualization: null,
      parameters: [],
    },
  ],
}

function widgetBody(name: string, stop: string) {
  return {
    visualization: { type: 'TEST_VD_ROWS', name, description: '', options: {} },
    data: { columns: [{ name: 'stop', friendly_name: 'stop', type: 'string' }], rows: [{ stop }] },
  }
}

const LABELS = http.get(`${DASHBOARD}/widgets/2/parameters/stop/values`, () =>
  HttpResponse.json({ values: [{ name: 'Central Station', value: '80214' }], truncated: false })
)

function renderDashboard(props: Partial<VeodynDashboardProps> = {}) {
  return render(
    <VeodynProvider baseUrl={BASE} plugins={PLUGINS}>
      <VeodynDashboard token={TOKEN} layout="grid" {...props} />
    </VeodynProvider>
  )
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('VeodynDashboard', () => {
  it('renders every widget in grid order, text through the sanitizing renderer', async () => {
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, () => HttpResponse.json(widgetBody('Departures', '80214'))),
      LABELS
    )

    const { container } = renderDashboard()

    expect(await screen.findByText('Departures: 80214')).toBeInTheDocument()
    const cells = container.querySelectorAll('[data-veodyn-part="dashboard-cell"]')
    expect([...cells].map((cell) => cell.getAttribute('data-veodyn-widget'))).toEqual(['1', '2'])
    expect(screen.getByRole('heading', { name: 'Detour' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Gerald Desmond' })).toHaveAttribute('href', 'https://bridge.test')
    expect(screen.getByRole('heading', { name: 'Departures' })).toBeInTheDocument()
  })

  it('places each widget at its dashboard position on the six-column grid', async () => {
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, () => HttpResponse.json(widgetBody('Departures', '80214'))),
      LABELS
    )

    const { container } = renderDashboard()

    await screen.findByText('Departures: 80214')
    const root = container.querySelector('[data-veodyn-part="dashboard"]') as HTMLElement
    expect(root.dataset.veodynLayout).toBe('grid')
    expect(root.style.gridTemplateColumns).toBe('repeat(6, minmax(0, 1fr))')
    const viz = container.querySelector('[data-veodyn-widget="2"]') as HTMLElement
    expect(viz.style.gridColumn).toBe('3 / span 4')
    expect(viz.style.gridRow).toBe('1 / span 6')
  })

  it('stacks the widgets in grid order with their own heights when told to', async () => {
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, () => HttpResponse.json(widgetBody('Departures', '80214'))),
      LABELS
    )

    const { container } = renderDashboard({ layout: 'stack' })

    await screen.findByText('Departures: 80214')
    const root = container.querySelector('[data-veodyn-part="dashboard"]') as HTMLElement
    expect(root.dataset.veodynLayout).toBe('stack')
    const viz = container.querySelector('[data-veodyn-widget="2"]') as HTMLElement
    expect(viz.style.gridColumn).toBe('')
    expect(viz.style.height).toBe(`${6 * 50 + 5 * 15}px`)
  })

  it('stacks on its own below the breakpoint', async () => {
    const observers: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          observers.push(callback)
        }
        observe(target: Element) {
          const callback = observers.at(-1)
          callback?.([{ target, contentRect: { width: 400, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
        }
        disconnect() {}
      }
    )
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, () => HttpResponse.json(widgetBody('Departures', '80214'))),
      LABELS
    )

    const { container } = renderDashboard({ layout: 'auto' })

    await waitFor(() =>
      expect((container.querySelector('[data-veodyn-part="dashboard"]') as HTMLElement).dataset.veodynLayout).toBe('stack')
    )
    vi.unstubAllGlobals()
  })

  it('shows the unavailable card for a revoked or unknown share, without naming the token', async () => {
    server.use(http.get(DASHBOARD, () => HttpResponse.json({ error: 'dashboard not available' }, { status: 404 })))

    const { container } = renderDashboard({ renderUnavailable: () => <p>Temporarily unavailable</p> })

    expect(await screen.findByText('Temporarily unavailable')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain(TOKEN)
  })

  it('renders from a server-fetched payload without a first request', async () => {
    let dashboardCalls = 0
    server.use(
      http.get(DASHBOARD, () => {
        dashboardCalls += 1
        return HttpResponse.json(DASHBOARD_BODY)
      }),
      http.get(`${DASHBOARD}/widgets/2`, () => HttpResponse.json(widgetBody('Departures', '80214'))),
      LABELS
    )

    renderDashboard({ initialPayload: DASHBOARD_BODY })

    expect(screen.getByRole('heading', { name: 'Detour' })).toBeInTheDocument()
    await screen.findByText('Departures: 80214')
    expect(dashboardCalls).toBe(0)
  })

  it('hands each visualization to the host frame with its title', async () => {
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, () => HttpResponse.json(widgetBody('Departures', '80214'))),
      LABELS
    )

    renderDashboard({
      renderWidgetFrame: ({ title, children }) => (
        <article aria-label={`card ${title}`}>
          {children}
        </article>
      ),
    })

    const card = await screen.findByRole('article', { name: 'card Departures' })
    expect(await within(card).findByText('Departures: 80214')).toBeInTheDocument()
  })

  it('sends a picked parameter to the widget and mirrors it into the page URL', async () => {
    const seen: string[] = []
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, ({ request }) => {
        const stop = new URL(request.url).searchParams.get('p_stop')
        seen.push(stop ?? '')
        return HttpResponse.json(widgetBody('Departures', stop ?? '80214'))
      }),
      http.get(`${DASHBOARD}/widgets/2/parameters/stop/values`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? ''
        const all = [
          { name: 'Central Station', value: '80214' },
          { name: 'Elm St / Market Center', value: '80211' },
        ]
        return HttpResponse.json({
          values: all.filter((v) => v.name.toLowerCase().startsWith(q.toLowerCase()) || v.value.startsWith(q)),
          truncated: false,
        })
      })
    )

    renderDashboard()

    await screen.findByText('Departures: 80214')
    const input = screen.getByRole('combobox', { name: 'Stop' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '7th' } })
    const option = await screen.findByRole('option', { name: 'Elm St / Market Center' })
    fireEvent.mouseDown(option)

    expect(await screen.findByText('Departures: 80211')).toBeInTheDocument()
    expect(seen).toContain('80211')
    expect(new URL(window.location.href).searchParams.get('p_stop')).toBe('80211')
  })

  it('starts from host-supplied parameter values', async () => {
    server.use(
      http.get(DASHBOARD, () => HttpResponse.json(DASHBOARD_BODY)),
      http.get(`${DASHBOARD}/widgets/2`, ({ request }) =>
        HttpResponse.json(widgetBody('Departures', new URL(request.url).searchParams.get('p_stop') ?? 'none'))
      ),
      http.get(`${DASHBOARD}/widgets/2/parameters/stop/values`, () =>
        HttpResponse.json({ values: [{ name: 'Elm St / Market Center', value: '80211' }], truncated: false })
      )
    )

    renderDashboard({ parameters: { stop: '80211' } })

    expect(await screen.findByText('Departures: 80211')).toBeInTheDocument()
  })
})
