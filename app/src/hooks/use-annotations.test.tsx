import { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAnnotations, useCreateAnnotation, useDeleteAnnotation } from './use-annotations'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockAnnotations } from '@/lib/mock-data'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

afterEach(() => {
  useMockDataStore.setState({ annotations: [...mockAnnotations] })
})

describe('useAnnotations (mock mode)', () => {
  it('returns only annotations for the requested dashboard', async () => {
    const dashboardId = mockAnnotations[0].dashboard_id
    const { result } = renderHook(() => useAnnotations(dashboardId), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    const data = result.current.data ?? []
    expect(data.length).toBeGreaterThan(0)
    expect(data.every((a) => a.dashboard_id === dashboardId)).toBe(true)
  })

  it('useCreateAnnotation adds an annotation with a new id via nextId', async () => {
    const before = useMockDataStore.getState().annotations.length
    const { result } = renderHook(() => useCreateAnnotation(), { wrapper })
    await result.current.mutateAsync({
      dashboard_id: 1,
      widget_id: null,
      start: '2026-03-01T00:00:00Z',
      end: null,
      label: 'Test annotation',
      source: 'manual',
    })
    const after = useMockDataStore.getState().annotations
    expect(after.length).toBe(before + 1)
    const created = after.at(-1)
    if (!created) throw new Error('expected a newly created annotation')
    expect(created.label).toBe('Test annotation')
    expect(typeof created.id).toBe('number')
    expect(typeof created.created_at).toBe('string')
    expect(new Date(created.created_at).toString()).not.toBe('Invalid Date')
  })

  it('useDeleteAnnotation removes it', async () => {
    const id = mockAnnotations[0].id
    const { result } = renderHook(() => useDeleteAnnotation(), { wrapper })
    await result.current.mutateAsync(id)
    expect(useMockDataStore.getState().annotations.some((a) => a.id === id)).toBe(false)
  })
})
