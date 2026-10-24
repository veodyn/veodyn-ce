import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { MapProvidersContext, useMapProvider, type MapProvider } from './index'

const PROVIDERS: MapProvider[] = [
  { id: 'maplibre', label: 'Map' },
  { id: 'google', label: 'Google', key: 'k-123', traffic: true },
]

function within(providers: readonly MapProvider[]) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <MapProvidersContext.Provider value={providers}>{children}</MapProvidersContext.Provider>
  }
  return Wrapper
}

describe('useMapProvider', () => {
  it('finds_a_provider_by_id_with_its_key', () => {
    const { result } = renderHook(() => useMapProvider('google'), { wrapper: within(PROVIDERS) })
    expect(result.current).toEqual({ id: 'google', label: 'Google', key: 'k-123', traffic: true })
  })

  it('returns_null_for_a_provider_the_instance_does_not_enable', () => {
    const { result } = renderHook(() => useMapProvider('google'), { wrapper: within([PROVIDERS[0]]) })
    expect(result.current).toBeNull()
  })

  it('returns_null_outside_any_provider_so_a_standalone_host_keeps_working', () => {
    const { result } = renderHook(() => useMapProvider('google'))
    expect(result.current).toBeNull()
  })
})
