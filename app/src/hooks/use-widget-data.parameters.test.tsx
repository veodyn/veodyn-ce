/**
 * A widget whose query takes parameters has to send them, and the cheap tiers
 * have to get out of the way when it does.
 *
 * The hook's default strategy is inline result, then stored result by id, then
 * execute. Both cheap tiers return whatever was last computed, which is the
 * result for some *other* set of parameter values: reusing it means changing a
 * dashboard filter and getting the previous filter's rows back. Executing with
 * max_age omitted is not wasteful either way, because Redash caches on the
 * rendered query text, so identical values still hit its cache.
 */
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import type { MockDashboardWidget } from '@/lib/mock-data'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

import { useWidgetData } from './use-widget-data'

const QUERY_ID = 11

const RESULT = {
  id: 5,
  query_hash: 'h',
  query: 'select 1',
  data: { columns: [], rows: [] },
  data_source_id: 1,
  runtime: 0.01,
  retrieved_at: '2026-07-15T00:00:00Z',
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

/** A widget carrying a stored result AND an inline one, so both cheap tiers are available. */
function parameterisedWidget(): MockDashboardWidget {
  return {
    id: 3,
    dashboard_id: 1,
    width: 1,
    options: {
      position: { col: 0, row: 0, sizeX: 3, sizeY: 5 },
      parameterMappings: { city: { type: 'dashboard-add-new', mapTo: 'region' } },
    },
    visualization: {
      id: 90,
      type: 'TABLE',
      name: 'T',
      description: '',
      options: {},
      query: {
        id: QUERY_ID,
        latest_query_data_id: 5,
        latest_query_data: {
          id: 5,
          data: { columns: [{ name: 'a', type: 'string', friendly_name: 'a' }], rows: [{ a: 'stale' }] },
        },
        options: {
          parameters: [{ name: 'city', title: 'City', type: 'enum', value: 'A', enumOptions: 'A\nB' }],
        },
      },
    },
  }
}

function serveExecution() {
  const posts: Array<Record<string, unknown>> = []
  server.use(
    http.post(`/api/node/queries/${QUERY_ID}/results`, async ({ request }) => {
      posts.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ query_result: RESULT })
    })
  )
  return posts
}

describe('a widget whose query takes parameters', () => {
  it('executes with the values it was given rather than reusing a stale result', async () => {
    const posts = serveExecution()

    const { result } = renderHook(() => useWidgetData(parameterisedWidget(), { city: 'B' }), {
      wrapper,
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(posts).toHaveLength(1)
    expect(posts[0].parameters).toEqual({ city: 'B' })
  })

  // Two widgets on one dashboard differ only by their values, so a key that
  // ignored them would serve one widget's rows to the other.
  it('caches per set of values, not per widget', async () => {
    const posts = serveExecution()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const sharedWrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const first = renderHook(() => useWidgetData(parameterisedWidget(), { city: 'A' }), {
      wrapper: sharedWrapper,
    })
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))

    const second = renderHook(() => useWidgetData(parameterisedWidget(), { city: 'B' }), {
      wrapper: sharedWrapper,
    })
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))

    expect(posts.map((p) => p.parameters)).toEqual([{ city: 'A' }, { city: 'B' }])
  })

  // The tiered strategy is still right for a query with nothing to vary.
  it('still takes the inline result when the query has no parameters', async () => {
    const posts = serveExecution()
    const base = parameterisedWidget()
    const widget: MockDashboardWidget = {
      ...base,
      options: { ...base.options, parameterMappings: undefined },
      visualization: base.visualization && {
        ...base.visualization,
        query: { ...base.visualization.query, options: { parameters: [] } },
      },
    }

    const { result } = renderHook(() => useWidgetData(widget, {}), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(posts).toHaveLength(0)
    expect(result.current.data?.data?.rows).toEqual([{ a: 'stale' }])
  })
})
