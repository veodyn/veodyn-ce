import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThreadSubjectLabel } from './use-thread-subject-label'

const client = vi.hoisted(() => ({ getThreadSubject: vi.fn() }))
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  ...client,
}))
const names = vi.hoisted(() => ({
  query: { data: undefined as { name: string } | null | undefined },
  dashboard: { data: undefined as { name: string } | null | undefined },
}))
vi.mock('@/hooks/use-queries', () => ({ useQueryById: () => names.query }))
vi.mock('@/hooks/use-dashboards', () => ({ useDashboard: () => names.dashboard }))

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function label() {
  return renderHook(() => useThreadSubjectLabel('thread-1'), { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  names.query.data = undefined
  names.dashboard.data = undefined
})

describe('useThreadSubjectLabel', () => {
  it('uses the default placeholder for a thread without a subject', async () => {
    client.getThreadSubject.mockResolvedValue({ subject: null })
    const { result } = label()
    await waitFor(() => expect(client.getThreadSubject).toHaveBeenCalledWith('thread-1', expect.any(AbortSignal)))
    expect(result.current).toBeUndefined()
  })

  it('names the object once it is known', async () => {
    client.getThreadSubject.mockResolvedValue({ subject: { kind: 'query', queryId: 7 } })
    names.query.data = { name: 'Rail boardings' }
    const { result } = label()
    await waitFor(() => expect(result.current).toBe('Ask about Rail boardings'))
  })

  it('names a dashboard widget by its dashboard', async () => {
    client.getThreadSubject.mockResolvedValue({ subject: { kind: 'widget', dashboardId: 4, widgetId: 21 } })
    names.dashboard.data = { name: 'Ops' }
    const { result } = label()
    await waitFor(() => expect(result.current).toBe('Ask about Ops'))
  })

  it('falls back to the kind while the name is unknown', async () => {
    client.getThreadSubject.mockResolvedValue({ subject: { kind: 'visualization', queryId: 7, visualizationId: 12 } })
    const { result } = label()
    await waitFor(() => expect(result.current).toBe('Ask about this visualization'))
  })

  it('names a dataset by its id', async () => {
    client.getThreadSubject.mockResolvedValue({ subject: { kind: 'dataset', datasetId: 'gtfs_stops' } })
    const { result } = label()
    await waitFor(() => expect(result.current).toBe('Ask about gtfs_stops'))
  })

  it('keeps the default placeholder when the subject cannot be read', async () => {
    client.getThreadSubject.mockRejectedValue(new Error('down'))
    const { result } = label()
    await waitFor(() => expect(client.getThreadSubject).toHaveBeenCalled())
    expect(result.current).toBeUndefined()
  })
})
