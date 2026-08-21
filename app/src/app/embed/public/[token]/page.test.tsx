import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { PLUGIN_API_VERSION, registerVisualization } from '@/lib/visualizations'
import PublicEmbedPage from './page'

const TOKEN = 'viz_tok_abc123456789'
const UNAVAILABLE = 'This visualization is no longer available.'

// What /api/public/visualizations/[token] serves, which carries no
// visualization id because Redash's public_visualization serializer sends none.
// See that route's test for the upstream body this is derived from.
const PAYLOAD = {
  visualization: {
    type: 'TABLE',
    name: 'Riders by station',
    description: '',
    options: {},
  },
  data: {
    columns: [{ name: 'station', friendly_name: 'Station', type: 'string' }],
    rows: [{ station: 'Central Station' }],
  },
}

// A type that never waits for a result, registered once for this file: what a
// wall image panel or a backdrop plugin is. The route serves `data: null` for
// its never-run query, and the page must still draw it.
const DATALESS_TYPE = 'TEST_EMBED_DATALESS_PANEL'
registerVisualization({
  apiVersion: PLUGIN_API_VERSION,
  type: DATALESS_TYPE,
  displayName: 'Dataless Panel',
  icon: () => null,
  defaultOptions: {},
  needs: 'none',
  Renderer: () => <div>Dataless panel content</div>,
})

// The page reads `params` via React's `use()`, which suspends on mount even for
// an already-resolved promise, so the render is wrapped in an awaited act() to
// flush that microtask and the Suspense retry it triggers.
async function renderPage(token: string, search: Record<string, string> = {}) {
  let view: ReturnType<typeof renderWithProviders> | undefined
  await act(async () => {
    view = renderWithProviders(
      <PublicEmbedPage params={Promise.resolve({ token })} searchParams={Promise.resolve(search)} />,
      // An anonymous reader, which is the only kind this page has.
      { authenticated: false }
    )
  })
  if (!view) throw new Error('Expected the page to render')
  return view
}

function respondWith(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    )
}

afterEach(() => {
  resetStores()
  vi.restoreAllMocks()
})

describe('PublicEmbedPage', () => {
  it('renders the shared visualization for a live token', async () => {
    const fetchSpy = respondWith(PAYLOAD)

    await renderPage(TOKEN)

    expect(await screen.findByText('Central Station')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /station/i })).toBeInTheDocument()
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`/api/public/visualizations/${TOKEN}`)
    // No session rides along: the token is the whole credential.
    expect((fetchSpy.mock.calls[0]?.[1] as RequestInit).credentials).toBe('omit')
  })

  it('renders the same way when the link carries a refresh cadence', async () => {
    // `?refresh=` only sets the refetch interval; the first paint is identical.
    // The cadence itself is a react-query refetchInterval, whose timer firing
    // is react-query's contract, not this page's.
    respondWith(PAYLOAD)

    await renderPage(TOKEN, { refresh: '60' })

    expect(await screen.findByText('Central Station')).toBeInTheDocument()
  })

  it('offers an anonymous reader no way to download the rows', async () => {
    respondWith(PAYLOAD)

    await renderPage(TOKEN)
    await screen.findByText('Central Station')

    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument()
  })

  it('is a dead link for a result-needing type whose query never ran', async () => {
    // The route now serves `data: null` rather than 404 for a never-run query,
    // because whether that is fatal depends on the type. For a TABLE it is:
    // same panel as a revoked token, exactly as before the change.
    respondWith({ ...PAYLOAD, data: null })

    await renderPage(TOKEN)

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
  })

  it('draws a needs-none plugin with no result at all', async () => {
    respondWith({
      visualization: { type: DATALESS_TYPE, name: 'Lobby panel', description: '', options: {} },
      data: null,
    })

    await renderPage(TOKEN)

    expect(await screen.findByText('Dataless panel content')).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
  })

  it.each([
    ['an unknown token', { error: 'visualization not available' }, 404],
    ['an unreachable backend', { error: 'redash backend unreachable' }, 502],
    ['an unconfigured deployment', { error: 'REDASH_URL not configured' }, 503],
  ] as const)('shows one clean unavailable page for %s', async (_label, body, status) => {
    respondWith(body, status)

    await renderPage(TOKEN)

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
    expect(screen.getByText('The link may have been revoked.')).toBeInTheDocument()
  })

  it('shows the same page when the request fails outright', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))

    await renderPage(TOKEN)

    expect(await screen.findByText(UNAVAILABLE)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('network down')
  })

  it('never echoes the token into the DOM, on either outcome', async () => {
    respondWith({ error: 'visualization not available' }, 404)
    const { unmount } = await renderPage(TOKEN)
    await screen.findByText(UNAVAILABLE)
    expect(document.body.innerHTML).not.toContain(TOKEN)
    unmount()

    vi.restoreAllMocks()
    respondWith(PAYLOAD)
    await renderPage(TOKEN)
    await screen.findByText('Central Station')
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  it('shows a placeholder rather than a not-found flash while loading', async () => {
    // The fetch stays pending until this test releases it, so "still loading"
    // is a state the test CREATES rather than one it races.
    //
    // It used to call respondWith(PAYLOAD), whose mockResolvedValue hands back
    // an already-settled promise, and then try to stop time with a single
    // `await Promise.resolve()` inside act(). Whether the placeholder was still
    // on screen came down to how many microtasks that act() happened to drain,
    // which is a property of the machine and not of the component: it passed
    // every time locally and failed on the slower CI runner on 2026-07-30,
    // blocking a deploy for a defect that did not exist.
    let release: (response: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockReturnValue(pending)

    const view = await renderPage(TOKEN)

    expect(view.container.querySelector('.animate-pulse')).toBeInTheDocument()
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument()
    // Every branch owns exactly one h1, so the page is never headingless.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    // Now let the response land, which proves the placeholder was the loading
    // state and not a page stuck on one.
    await act(async () => {
      release(
        new Response(JSON.stringify(PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    })

    expect(await screen.findByText('Central Station')).toBeInTheDocument()
    expect(view.container.querySelector('.animate-pulse')).not.toBeInTheDocument()
  })
})
