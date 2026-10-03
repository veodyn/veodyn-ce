'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface VizEnvironment {
  assetsUrl: string
  root: HTMLElement | null
  portalContainer: HTMLElement | null
}

const DEFAULT_ENVIRONMENT: VizEnvironment = { assetsUrl: '', root: null, portalContainer: null }

const VizEnvironmentContext = createContext<VizEnvironment>(DEFAULT_ENVIRONMENT)

export function VizEnvironmentProvider({
  assetsUrl = '',
  root = null,
  portalContainer = null,
  children,
}: Partial<VizEnvironment> & { children: ReactNode }) {
  const value = useMemo(() => ({ assetsUrl, root, portalContainer }), [assetsUrl, root, portalContainer])
  return <VizEnvironmentContext.Provider value={value}>{children}</VizEnvironmentContext.Provider>
}

export function useVizEnvironment(): VizEnvironment {
  return useContext(VizEnvironmentContext)
}

export function geoJsonUrl(assetsUrl: string, mapType: string): string {
  return `${assetsUrl.replace(/\/+$/, '')}/geo/${mapType}.geojson`
}
