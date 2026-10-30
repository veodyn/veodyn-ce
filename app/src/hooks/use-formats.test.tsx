import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const orgSettings = vi.hoisted(() => ({
  useOrgSettings: vi.fn((opts: { enabled?: boolean } = {}) => ({
    data: opts.enabled === false ? undefined : { date_format: 'YYYY-MM-DD', time_format: 'HH:mm:ss' },
  })),
}))
vi.mock('@/hooks/use-org-settings', () => orgSettings)

import { useAuthStore } from '@/stores/auth-store'
import { resetStores, signInAsAdmin } from '@/test/utils'
import { useFormats } from './use-formats'

function signInAsViewer() {
  const viewer = signInAsAdmin({ isAdmin: false, permissions: ['view_query'] })
  useAuthStore.setState({
    currentUser: viewer,
    clientConfig: {
      ...useAuthStore.getState().clientConfig,
      dateFormat: 'DD/MM/YY',
      dateTimeFormat: 'DD/MM/YY HH:mm:ss.SSS',
    },
  })
}

afterEach(() => {
  resetStores()
  orgSettings.useOrgSettings.mockClear()
})

describe('useFormats', () => {
  it('does not ask a non-admin for the admin-only org settings', () => {
    signInAsViewer()
    renderHook(() => useFormats())
    expect(orgSettings.useOrgSettings).toHaveBeenCalledWith({ enabled: false })
  })

  it('takes both formats from the session for a non-admin', () => {
    signInAsViewer()
    const { result } = renderHook(() => useFormats())
    expect(result.current.dateFormat).toBe('DD/MM/YY')
    expect(result.current.timeFormat).toBe('HH:mm:ss.SSS')
  })

  it('reads the org settings an admin can edit, and they win', () => {
    signInAsAdmin()
    const { result } = renderHook(() => useFormats())
    expect(orgSettings.useOrgSettings).toHaveBeenCalledWith({ enabled: true })
    expect(result.current.dateFormat).toBe('YYYY-MM-DD')
    expect(result.current.timeFormat).toBe('HH:mm:ss')
  })

  it('keeps a caller that disabled the request disabled for an admin', () => {
    signInAsAdmin()
    renderHook(() => useFormats({ enabled: false }))
    expect(orgSettings.useOrgSettings).toHaveBeenCalledWith({ enabled: false })
  })
})
