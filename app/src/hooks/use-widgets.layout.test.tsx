import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MockDashboardWidget } from '@/lib/mock-data'

const { updateWidget } = vi.hoisted(() => ({ updateWidget: vi.fn() }))

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))
vi.mock('@/services/redash/widgets', () => ({
  createWidget: vi.fn(),
  updateWidget,
  deleteWidget: vi.fn(),
}))

import { useSaveLayout } from './use-widgets'

function moved(id: number): MockDashboardWidget {
  return { id, dashboard_id: 22, width: 1, options: { position: { col: 0, row: 8, sizeX: 6, sizeY: 8 } } }
}

function setup() {
  const failedKeys: unknown[] = []
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onError: (_error, _vars, _ctx, mutation) => {
        failedKeys.push(mutation.options.mutationKey)
      },
    }),
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useSaveLayout(), { wrapper })
  return { result, failedKeys, invalidate }
}

describe('useSaveLayout', () => {
  it('writes only the widgets it is given', async () => {
    updateWidget.mockResolvedValue(undefined)
    const { result } = setup()

    await act(() => result.current.mutateAsync({ dashboardId: 22, widgets: [moved(113)] }))

    expect(updateWidget).toHaveBeenCalledTimes(1)
    expect(updateWidget).toHaveBeenCalledWith(113, expect.objectContaining({ options: moved(113).options }))
  })

  it('names a refused save widget-layout and reloads the saved arrangement', async () => {
    updateWidget.mockRejectedValue(new Error('403'))
    const { result, failedKeys, invalidate } = setup()

    act(() => result.current.mutate({ dashboardId: 22, widgets: [moved(113)] }))

    await waitFor(() => expect(failedKeys).toEqual([['widget-layout']]))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard', 22] })
  })
})
