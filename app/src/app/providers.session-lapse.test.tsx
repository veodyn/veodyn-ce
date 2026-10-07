import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import type { TelemetryClientConfig } from '@/lib/observability/telemetryConfig'
import { useAuthStore } from '@/stores/auth-store'
import { Providers } from './providers'

const config = toClientConfig(NEUTRAL_CONFIG)

const telemetryOff: TelemetryClientConfig = {
  key: '',
  host: '',
  release: '',
  commit: '',
  org: '',
  disabled: false,
  consoleForwarding: false,
}

function CatalogRead() {
  useQuery({
    queryKey: ['catalog'],
    queryFn: async () => {
      throw new AppError(ErrorIds.CATALOG_FETCH_FAILED, 'catalog failed', { status: 401 })
    },
    retry: false,
  })
  return null
}

afterEach(() => {
  useAuthStore.setState({ currentUser: null, isAuthenticated: false, isLoading: false })
  vi.unstubAllGlobals()
})

describe('a tab whose session lapsed while it was open', () => {
  it('signs itself out when a read answers 401 and the session route agrees', async () => {
    useAuthStore.setState({
      currentUser: { id: 3, name: 'Analyst' } as never,
      isAuthenticated: true,
      isLoading: false,
    })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <Providers config={config} telemetry={telemetryOff} initialSession={null}>
        <CatalogRead />
      </Providers>
    )

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', { credentials: 'include' })
  })
})
