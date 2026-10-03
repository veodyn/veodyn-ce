import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { geoJsonUrl, useVizEnvironment, VizEnvironmentProvider } from './viz-environment'

describe('geoJsonUrl', () => {
  it('stays same-origin when no assets origin is set', () => {
    expect(geoJsonUrl('', 'world-countries')).toBe('/geo/world-countries.geojson')
  })

  it('prefixes an assets origin, tolerating a trailing slash', () => {
    expect(geoJsonUrl('https://veodyn.example/', 'world-countries')).toBe(
      'https://veodyn.example/geo/world-countries.geojson'
    )
  })
})

describe('useVizEnvironment', () => {
  it('defaults to the document and the same origin outside any provider', () => {
    const { result } = renderHook(() => useVizEnvironment())

    expect(result.current).toEqual({ assetsUrl: '', root: null, portalContainer: null })
  })

  it('reads what a provider supplies', () => {
    const root = document.createElement('div')
    const portalContainer = document.createElement('div')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <VizEnvironmentProvider assetsUrl="https://veodyn.example" root={root} portalContainer={portalContainer}>
        {children}
      </VizEnvironmentProvider>
    )

    const { result } = renderHook(() => useVizEnvironment(), { wrapper })

    expect(result.current).toEqual({ assetsUrl: 'https://veodyn.example', root, portalContainer })
  })
})
