import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captureMock = vi.hoisted(() => ({ capture: vi.fn(), currentRoute: () => '/kpis' }))
vi.mock('@/lib/observability/capture', () => captureMock)

const sonnerMock = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))
vi.mock('sonner', () => sonnerMock)

import { useToast } from './toast-provider'

beforeEach(() => vi.clearAllMocks())

describe('useToast error telemetry', () => {
  it('captures app_error_shown when an error toast is raised', () => {
    renderHook(() => useToast()).result.current.error('Could not load dashboard')
    expect(captureMock.capture).toHaveBeenCalledWith('app_error_shown', {
      message: 'Could not load dashboard',
      errorId: '',
      route: '/kpis',
    })
  })

  it('threads an errorId when the caller supplies one', () => {
    renderHook(() => useToast()).result.current.error('Upstream failed', { errorId: 'E_UP_003' })
    expect(captureMock.capture).toHaveBeenCalledWith('app_error_shown', {
      message: 'Upstream failed',
      errorId: 'E_UP_003',
      route: '/kpis',
    })
  })

  it('still shows the toast, with the same dedupe id as before', () => {
    renderHook(() => useToast()).result.current.error('Could not load dashboard')
    expect(sonnerMock.toast.error).toHaveBeenCalledWith('Could not load dashboard', {
      id: 'error:Could not load dashboard',
    })
  })

  it('does not capture for success, info or warning toasts', () => {
    const { result } = renderHook(() => useToast())
    result.current.success('saved')
    result.current.info('fyi')
    result.current.warning('careful')
    expect(captureMock.capture).not.toHaveBeenCalled()
  })
})
