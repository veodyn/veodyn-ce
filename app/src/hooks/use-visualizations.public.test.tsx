import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { usePublicVisualization } from '@/hooks/use-visualizations'

const TABLE = { columns: [{ name: 'n', friendly_name: 'n', type: 'integer' }], rows: [{ n: 1 }] }
const PENDING = { visualization: { type: 'CHART', name: 'n', description: '', options: {} }, data: null, status: 'pending' }
const FRESH = { ...PENDING, data: TABLE, status: 'fresh' }

function pending() {
  return new Response(JSON.stringify(PENDING), { status: 202, headers: { 'Retry-After': '1' } })
}

function setup(respond: (url: string, calls: number) => Response) {
  const urls: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    urls.push(String(input))
    return Promise.resolve(respond(String(input), urls.length))
  })
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { urls, client, wrapper }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('usePublicVisualization parameters', () => {
  it('keys the query by token and canonical parameters', async () => {
    const { client, wrapper } = setup(() => Response.json(FRESH))

    const { result } = renderHook(() => usePublicVisualization('tok', { parameters: { route: 'B', a: 2 } }), { wrapper })
    await waitFor(() => expect(result.current.data).toBeTruthy())

    expect(client.getQueryCache().getAll()[0]?.queryKey).toEqual([
      'public-visualization',
      'tok',
      [
        ['a', '2'],
        ['route', 'B'],
      ],
    ])
  })

  it('gives two parameter sets two cache entries', async () => {
    const { urls, client, wrapper } = setup(() => Response.json(FRESH))

    const { result, rerender } = renderHook(
      ({ route }: { route: string }) => usePublicVisualization('tok', { parameters: { route } }),
      { wrapper, initialProps: { route: 'A' } }
    )
    await waitFor(() => expect(result.current.data).toBeTruthy())
    rerender({ route: 'B' })
    await waitFor(() => expect(urls).toHaveLength(2))

    expect(client.getQueryCache().getAll()).toHaveLength(2)
    expect(urls).toEqual([
      '/api/public/visualizations/tok?p_route=A',
      '/api/public/visualizations/tok?p_route=B',
    ])
  })

  it('refetches after Retry-After while pending, then settles on fresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { urls, wrapper } = setup((_url, calls) => (calls < 3 ? pending() : Response.json(FRESH)))

    const { result } = renderHook(() => usePublicVisualization('tok', { parameters: { route: 'A' } }), { wrapper })
    await waitFor(() => expect(urls).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(2_500))

    await waitFor(() => expect(result.current.data?.status).toBe('fresh'))
    expect(urls).toHaveLength(3)
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(urls).toHaveLength(3)
  })

  it('falls back to 30 seconds after 10 retries and resets on a parameter change', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { urls, wrapper } = setup(() => pending())

    const { rerender } = renderHook(
      ({ route }: { route: string }) => usePublicVisualization('tok', { parameters: { route } }),
      { wrapper, initialProps: { route: 'A' } }
    )
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    expect(urls).toHaveLength(11)
    await act(() => vi.advanceTimersByTimeAsync(28_000))
    expect(urls).toHaveLength(11)
    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(urls).toHaveLength(12)

    rerender({ route: 'B' })
    await act(() => vi.advanceTimersByTimeAsync(3_500))
    expect(urls.filter((url) => url.endsWith('p_route=B')).length).toBeGreaterThanOrEqual(4)
  })

  it('keeps the plain refresh cadence for a fresh payload', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { urls, wrapper } = setup(() => Response.json(FRESH))

    renderHook(() => usePublicVisualization('tok', { refetchIntervalMs: 15_000 }), { wrapper })
    await waitFor(() => expect(urls).toHaveLength(1))
    await act(() => vi.advanceTimersByTimeAsync(15_500))

    expect(urls).toHaveLength(2)
    expect(urls[0]).toBe('/api/public/visualizations/tok')
  })
})
