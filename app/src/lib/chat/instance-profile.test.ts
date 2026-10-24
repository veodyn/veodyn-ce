import { describe, expect, it, vi } from 'vitest'
import type { FeatureDescriptor } from '@/features'
import { NEUTRAL_CONFIG } from '@/lib/config-schema'
import { buildInstanceProfile } from './instance-profile'

vi.mock('@/lib/config', () => ({ config: {} }))

function feature(id: string, enabled?: () => boolean): FeatureDescriptor {
  return { id, nav: [], routes: [], enabled } as unknown as FeatureDescriptor
}

const TENANT = { ...NEUTRAL_CONFIG, brand: { ...NEUTRAL_CONFIG.brand, name: 'Meridian Transit' } }

describe('buildInstanceProfile', () => {
  it('reads_edition_features_plugins', () => {
    const registry = { alerts: feature('alerts'), wall: feature('wall', () => false) }
    const profile = buildInstanceProfile(TENANT, registry, ['Route Live Map'])
    expect(profile.name).toBe('Meridian Transit')
    expect(profile.edition).toBe('EE')
    expect(profile.features).toEqual(['alerts'])
    expect(profile.plugins).toEqual(['Route Live Map'])
  })

  it('reports_community_when_no_feature_is_installed', () => {
    expect(buildInstanceProfile(TENANT, {}, []).edition).toBe('CE')
  })

  it('reports_hub_scale_with_features_installed', () => {
    const hub = { ...TENANT, deployment: { scale: 'hub' as const } }
    expect(buildInstanceProfile(hub, { alerts: feature('alerts') }, []).edition).toBe('HUB')
  })

  it('lists_optional_surfaces_the_config_turns_on', () => {
    const on = {
      ...TENANT,
      features: { query_snippets: true, query_drafts: false },
      messages: { enabled: true },
      connectors: { enabled: false },
    }
    expect(buildInstanceProfile(on, {}, []).features).toEqual(['query_snippets', 'messages'])
  })

  it('lists_the_enabled_map_providers_by_label_without_their_settings', () => {
    const configured = {
      ...TENANT,
      map: {
        ...TENANT.map,
        providers: [
          { id: 'maplibre' as const, label: 'Streets' },
          { id: 'google' as const, label: 'Google', traffic: true },
        ],
      },
    }
    expect(buildInstanceProfile(configured, {}, []).maps).toEqual([
      { id: 'maplibre', label: 'Streets' },
      { id: 'google', label: 'Google' },
    ])
  })

  it('offers_one_maplibre_basemap_when_providers_are_absent', () => {
    expect(buildInstanceProfile(TENANT, {}, []).maps).toEqual([{ id: 'maplibre', label: 'Map' }])
  })
})
