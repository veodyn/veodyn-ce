import { createContext, useContext } from 'react'

export interface MapProvider {
  id: string
  label: string
  key?: string
  traffic?: boolean
}

const NO_PROVIDERS: readonly MapProvider[] = []

export const MapProvidersContext = createContext<readonly MapProvider[]>(NO_PROVIDERS)

export function useMapProvider(id: string): MapProvider | null {
  const providers = useContext(MapProvidersContext)
  return providers.find((provider) => provider.id === id) ?? null
}
