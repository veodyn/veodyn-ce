import { describe, expect, it, vi } from 'vitest'
import { NEUTRAL_CONFIG, toClientConfig, veodynConfigSchema } from './config-schema'
import { DEFAULT_MAP_PROVIDERS, clientMapProviders, dropUnkeyedGoogle, effectiveMapProviders } from './config-maps'

function parseMap(map: unknown) {
  return veodynConfigSchema.safeParse({ map })
}

describe('map providers in the config schema', () => {
  it('providers_absent_means_maplibre_only', () => {
    expect(NEUTRAL_CONFIG.map.providers).toBeUndefined()
    expect(effectiveMapProviders(NEUTRAL_CONFIG.map)).toEqual([{ id: 'maplibre', label: 'Map' }])
    expect(effectiveMapProviders(NEUTRAL_CONFIG.map)).toEqual(DEFAULT_MAP_PROVIDERS)
  })

  it('reads_a_list_of_providers_with_their_own_settings', () => {
    const parsed = parseMap({
      providers: [
        { id: 'maplibre', label: 'Streets' },
        { id: 'google', label: 'Google', traffic: true },
      ],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.map.providers).toEqual([
        { id: 'maplibre', label: 'Streets' },
        { id: 'google', label: 'Google', traffic: true },
      ])
    }
  })

  it('labels_a_provider_that_names_none', () => {
    const parsed = parseMap({ providers: [{ id: 'maplibre' }, { id: 'google' }] })
    expect(parsed.success && parsed.data.map.providers?.map((one) => one.label)).toEqual(['Map', 'Google'])
  })

  it('google_key_comes_from_env_not_yaml', () => {
    expect(parseMap({ providers: [{ id: 'google', label: 'Google', key: 'from-yaml' }] }).success).toBe(false)
    const parsed = parseMap({ providers: [{ id: 'maplibre', label: 'Map' }, { id: 'google', label: 'Google' }] })
    if (!parsed.success) throw new Error('should parse')
    const client = toClientConfig(parsed.data, { googleMapsKey: 'from-env' })
    expect(client.map.providers).toEqual([
      { id: 'maplibre', label: 'Map' },
      { id: 'google', label: 'Google', key: 'from-env' },
    ])
  })

  it('leaves_providers_unset_in_the_client_config_when_the_instance_names_none', () => {
    expect(toClientConfig(NEUTRAL_CONFIG, { googleMapsKey: 'unused' }).map.providers).toBeUndefined()
  })

  it('refuses_an_empty_list_and_an_unknown_provider', () => {
    expect(parseMap({ providers: [] }).success).toBe(false)
    expect(parseMap({ providers: [{ id: 'mapbox', label: 'Mapbox' }] }).success).toBe(false)
  })
})

describe('clientMapProviders', () => {
  it('hands_the_browser_the_keyed_providers_the_instance_configured', () => {
    const parsed = parseMap({ providers: [{ id: 'maplibre' }, { id: 'google', traffic: true }] })
    if (!parsed.success) throw new Error('should parse')
    const client = toClientConfig(parsed.data, { googleMapsKey: 'from-env' })
    expect(clientMapProviders(client.map)).toEqual([
      { id: 'maplibre', label: 'Map' },
      { id: 'google', label: 'Google', traffic: true, key: 'from-env' },
    ])
  })

  it('hands_the_browser_one_maplibre_basemap_when_none_are_configured', () => {
    expect(clientMapProviders(toClientConfig(NEUTRAL_CONFIG).map)).toEqual(DEFAULT_MAP_PROVIDERS)
  })
})

describe('dropUnkeyedGoogle', () => {
  const both = [
    { id: 'maplibre' as const, label: 'Map' },
    { id: 'google' as const, label: 'Google' },
  ]

  it('google_provider_without_key_is_dropped', () => {
    const warn = vi.fn()
    expect(dropUnkeyedGoogle(both, '', warn)).toEqual([{ id: 'maplibre', label: 'Map' }])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('keeps_google_when_the_key_is_set', () => {
    const warn = vi.fn()
    expect(dropUnkeyedGoogle(both, 'abc', warn)).toEqual(both)
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls_back_to_the_maplibre_basemap_when_only_an_unkeyed_google_was_listed', () => {
    expect(dropUnkeyedGoogle([both[1]], '', vi.fn())).toEqual(DEFAULT_MAP_PROVIDERS)
  })

  it('leaves_an_absent_list_absent', () => {
    expect(dropUnkeyedGoogle(undefined, '', vi.fn())).toBeUndefined()
  })
})
