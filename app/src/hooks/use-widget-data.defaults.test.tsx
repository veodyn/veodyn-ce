import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import type { MockDashboardWidget, MockQueryParameter } from '@/lib/mock-data'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

import { useWidgetData } from './use-widget-data'

const QUERY_ID = 21
const STORED_RESULT_ID = 7

const RESULT = {
  id: 8,
  query_hash: 'h',
  query: 'select 1',
  data: { columns: [{ name: 'stop', type: 'string', friendly_name: 'stop' }], rows: [{ stop: 'North' }] },
  data_source_id: 1,
  runtime: 0.01,
  retrieved_at: '2026-10-26T00:00:00Z',
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function widgetOn(
  type: string,
  parameters: MockQueryParameter[],
  parameterMappings?: Record<string, unknown>
): MockDashboardWidget {
  return {
    id: 4,
    dashboard_id: 2,
    width: 1,
    options: { position: { col: 0, row: 0, sizeX: 3, sizeY: 10 }, parameterMappings },
    visualization: {
      id: 91,
      type,
      name: 'Board',
      description: '',
      options: {},
      query: {
        id: QUERY_ID,
        name: 'Next departures',
        latest_query_data_id: STORED_RESULT_ID,
        options: { parameters },
      },
    },
  }
}

function serveLikeTheBackend(declared: string[]) {
  const posts: Array<Record<string, unknown>> = []
  server.use(
    http.post(`/api/node/queries/${QUERY_ID}/results`, async ({ request }) => {
      const body = (await request.json()) as { parameters?: Record<string, unknown> }
      posts.push(body)
      const missing = declared.filter((name) => !(name in (body.parameters ?? {})))
      if (missing.length > 0) {
        return HttpResponse.json(
          { job: { status: 4, error: `Missing parameter value for: ${missing.join(', ')}` } },
          { status: 400 }
        )
      }
      return HttpResponse.json({ query_result: RESULT })
    })
  )
  return posts
}

describe('a widget whose caller passes no parameters', () => {
  it('sends the static value its mapping stores, as the dashboard view does', async () => {
    const posts = serveLikeTheBackend(['route'])
    const widget = widgetOn(
      'PLUGIN_ROUTE_MAP',
      [{ name: 'route', title: 'route', type: 'text', value: 'R1' }],
      { route: { type: 'static-value', mapTo: 'route', title: 'route', value: 'R9' } }
    )

    const { result } = renderHook(() => useWidgetData(widget), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(posts.map((p) => p.parameters)).toEqual([{ route: 'R9' }])
    expect(result.current.data?.data?.rows).toEqual([{ stop: 'North' }])
  })

  it('sends the saved defaults of a query whose widget maps nothing', async () => {
    const posts = serveLikeTheBackend(['point', 'radius', 'limit'])
    const widget = widgetOn('PLUGIN_SCHEDULE_TABLE', [
      { name: 'point', title: 'Point', type: 'text', value: '1.5,2.5' },
      { name: 'radius', title: 'Radius', type: 'number', value: 400 },
      { name: 'limit', title: 'Limit', type: 'number', value: 30 },
    ])

    const { result } = renderHook(() => useWidgetData(widget), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(posts.map((p) => p.parameters)).toEqual([{ point: '1.5,2.5', radius: 400, limit: 30 }])
    expect(result.current.data?.data?.rows).toEqual([{ stop: 'North' }])
  })
})
