/**
 * The annotations READ against an instance that has no annotations backend.
 *
 * The Annotate control is already gated on ANNOTATIONS_SUPPORTED; the list was
 * not, so opening any dashboard against a real node fired
 * GET /api/node/annotations?dashboard_id=N at a route that does not exist and
 * took a 404. Nothing surfaced it: the consumer destructures `data` only, so a
 * failed read and an empty one look identical on screen.
 *
 * Mock shape mirrors visualization-widget.annotate-gate.test.tsx: the constant
 * is what this file switches, and the three call sites stay present so nothing
 * importing them breaks.
 */
import { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { list } = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@/services/redash/annotations', () => ({
  ANNOTATIONS_SUPPORTED: false,
  list,
  create: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

import { useAnnotations } from './use-annotations'

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('useAnnotations where no annotations backend exists', () => {
  it('asks the backend nothing and resolves empty', async () => {
    const { result } = renderHook(() => useAnnotations(1), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })
})
