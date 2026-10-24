import { z } from 'zod'

export const mapProviderSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('maplibre'), label: z.string().default('Map') }).strict(),
  z
    .object({ id: z.literal('google'), label: z.string().default('Google'), traffic: z.boolean().optional() })
    .strict(),
])

export const mapProvidersSchema = z.array(mapProviderSchema).min(1)

export type MapProviderConfig = z.infer<typeof mapProviderSchema>

export type ClientMapProvider = MapProviderConfig & { key?: string }

export const DEFAULT_MAP_PROVIDERS: MapProviderConfig[] = [{ id: 'maplibre', label: 'Map' }]

export function effectiveMapProviders(map: { providers?: MapProviderConfig[] }): MapProviderConfig[] {
  return map.providers ?? DEFAULT_MAP_PROVIDERS
}

export function clientMapProviders(map: { providers?: ClientMapProvider[] }): ClientMapProvider[] {
  return map.providers ?? DEFAULT_MAP_PROVIDERS
}

export function dropUnkeyedGoogle(
  providers: MapProviderConfig[] | undefined,
  googleKey: string,
  warn: (message: string) => void
): MapProviderConfig[] | undefined {
  if (!providers) return providers
  const usable = providers.filter((provider) => provider.id !== 'google' || googleKey !== '')
  if (usable.length === providers.length) return providers
  warn(
    '[config] map.providers lists a google provider but VEODYN_MAPS__GOOGLE__KEY is not set, so the google ' +
      'provider is dropped.'
  )
  return usable.length > 0 ? usable : DEFAULT_MAP_PROVIDERS
}

export function withGoogleKey(providers: MapProviderConfig[], googleKey: string | undefined): ClientMapProvider[] {
  return providers.map((provider) =>
    provider.id === 'google' && googleKey ? { ...provider, key: googleKey } : provider
  )
}
