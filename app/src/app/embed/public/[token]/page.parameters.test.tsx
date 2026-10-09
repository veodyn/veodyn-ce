import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { PLUGIN_API_VERSION, registerVisualization } from '@veodyn/viz'
import type { VisualizationRendererProps } from '@veodyn/viz/lib/visualizations/plugin'
import PublicEmbedPage from './page'

const TOKEN = 'viz_tok_abc123456789'
const UNAVAILABLE = 'This visualization is no longer available.'
const STAMPED = 'TEST_EMBED_STAMPED'

function Stamped({ retrievedAt }: VisualizationRendererProps) {
  return <p>{`stamped ${retrievedAt ?? 'never'}`}</p>
}

registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: STAMPED,
  displayName: 'Stamped',
  icon: () => null,
  defaultOptions: {},
  Renderer: Stamped,
})

const NONE = 'TEST_EMBED_NONE'

registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: NONE,
  displayName: 'None',
  icon: () => null,
  defaultOptions: {},
  needs: 'none',
  Renderer: () => <p>none panel</p>,
})

const BODY = {
  visualization: { type: STAMPED, name: 'Route', description: '', options: {} },
  data: { columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: [{ n: 1 }] },
}

async function renderPage(search: Record<string, string | string[]>) {
  await act(async () => {
    renderWithProviders(
      <PublicEmbedPage params={Promise.resolve({ token: TOKEN })} searchParams={Promise.resolve(search)} />,
      { authenticated: false }
    )
  })
}

function respondWith(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Retry-After': '30' } }))
}

afterEach(() => {
  resetStores()
  vi.restoreAllMocks()
})

describe('PublicEmbedPage parameters', () => {
  it('passes every p_ search parameter through and nothing else', async () => {
    const spy = respondWith({ ...BODY, retrievedAt: '2026-10-08T10:00:00Z' })

    await renderPage({ p_route: 'MT020', p_a: '1', refresh: '60', other: 'x' })

    expect(await screen.findByText('stamped 2026-10-08T10:00:00Z')).toBeInTheDocument()
    expect(spy.mock.calls[0]?.[0]).toBe(`/api/public/visualizations/${TOKEN}?p_a=1&p_route=MT020`)
  })

  it('requests the bare route with no p_ parameter', async () => {
    const spy = respondWith(BODY)

    await renderPage({ refresh: '60' })

    await screen.findByText('stamped never')
    expect(spy.mock.calls[0]?.[0]).toBe(`/api/public/visualizations/${TOKEN}`)
  })

  it('shows the loading skeleton for a pending payload with no data', async () => {
    respondWith({ ...BODY, data: null, status: 'pending' }, 202)

    await renderPage({ p_route: 'MT020' })

    expect(await screen.findByText('Loading this visualization')).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
  })

  it('shows the unavailable page for an unavailable payload with no data', async () => {
    respondWith({ ...BODY, data: null, status: 'unavailable' }, 503)

    await renderPage({ p_route: 'MT020' })

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
  })

  it('renders data whatever the status', async () => {
    respondWith({ ...BODY, status: 'stale' })

    await renderPage({ p_route: 'MT020' })

    expect(await screen.findByText('stamped never')).toBeInTheDocument()
  })

  it('renders unavailable and fetches nothing for a repeated p_ key', async () => {
    const spy = respondWith(BODY)

    await renderPage({ p_route: ['MT020', 'MT999'] })

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })

  it('forwards a p___proto__ key instead of dropping it', async () => {
    const spy = respondWith(BODY)

    await renderPage({ p___proto__: 'x' })

    await screen.findByText('stamped never')
    expect(spy.mock.calls[0]?.[0]).toBe(`/api/public/visualizations/${TOKEN}?p___proto__=x`)
  })

  it('shows unavailable for an unavailable payload with no data, even for a needs-none plugin', async () => {
    respondWith(
      { visualization: { type: NONE, name: 'Panel', description: '', options: {} }, data: null, status: 'unavailable' },
      503
    )

    await renderPage({ p_route: 'MT020' })

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
    expect(screen.queryByText('none panel')).not.toBeInTheDocument()
  })
})
