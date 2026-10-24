import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE_CHOICE_GUIDES } from '@veodyn/viz/lib/visualizations/choice-guides'

vi.mock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} } } }))

const { vizCatalog } = await import('./viz-catalog')

describe('vizCatalog', () => {
  it('offers the core shapes with the type each one produces', () => {
    const byId = new Map(vizCatalog().map((entry) => [entry.id, entry]))
    expect(byId.get('table')?.type).toBe('TABLE')
    expect(byId.get('map')?.type).toBe('MAP')
    expect(byId.get('chart-bar')?.type).toBe('CHART')
    expect(byId.get('chart-line')?.type).toBe('CHART')
  })

  it('carries the guide that tells the model when to pick a shape', () => {
    const map = vizCatalog().find((entry) => entry.id === 'map')
    expect(map?.guide).toBe(CORE_CHOICE_GUIDES.map)
    expect(map?.guide).toContain('`lat`')
  })

  it('leaves the guide off a shape nobody wrote one for', () => {
    const entries = vizCatalog()
    const unexplained = entries.filter((entry) => entry.guide === undefined)
    for (const entry of unexplained) expect('guide' in entry).toBe(false)
  })

  it('gives every entry the four fields the API reads', () => {
    for (const entry of vizCatalog()) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.type).toBe('string')
      expect(typeof entry.label).toBe('string')
      expect(entry.id).not.toBe('')
      expect(entry.type).not.toBe('')
    }
  })

  it('names no shape twice', () => {
    const ids = vizCatalog().map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('instance visibility', () => {
  it('offers only what the operator enabled', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({
      config: { visualizations: { enabled: ['TABLE', 'MAP'], audience: {} } },
    }))
    const { vizCatalog: restricted } = await import('./viz-catalog')
    expect(restricted().map((entry) => entry.type).sort()).toEqual(['MAP', 'TABLE'])
  })

  it('drops a type the operator marked internal, so the model cannot reach for it', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({
      config: { visualizations: { enabled: null, audience: { MAP: 'internal' } } },
    }))
    const { vizCatalog: hidden } = await import('./viz-catalog')
    expect(hidden().some((entry) => entry.type === 'MAP')).toBe(false)
    expect(hidden().some((entry) => entry.type === 'TABLE')).toBe(true)
  })
})

describe('catalog guards', () => {
  afterEach(() => {
    vi.doUnmock('@veodyn/viz/lib/visualizations')
    vi.doUnmock('@/lib/viz-choices')
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function withTypes(types: string[]) {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} } } }))
    vi.doMock('@veodyn/viz/lib/visualizations', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      registeredTypes: () => types,
    }))
    return import('./viz-catalog')
  }

  it('catalog_is_empty_when_core_types_are_not_registered', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { vizCatalog: lost } = await withTypes(['TABLE'])
    expect(lost()).toEqual([])
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('logs_the_lost_registration_once_per_process', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { vizCatalog: lost } = await withTypes([])
    lost()
    lost()
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('keeps_the_catalog_when_the_operator_hides_a_core_type_but_it_is_registered', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ config: { visualizations: { enabled: ['TABLE'], audience: {} } } }))
    const { vizCatalog: narrowed } = await import('./viz-catalog')
    expect(narrowed().map((entry) => entry.type)).toEqual(['TABLE'])
    expect(error).not.toHaveBeenCalled()
  })

  it('drops_an_entry_over_a_sidecar_limit_instead_of_sending_it', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} } } }))
    const choice = (id: string, guide?: string) => ({ id, label: id, type: 'TABLE', options: {}, Thumbnail: null, guide })
    vi.doMock('@/lib/viz-choices', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/viz-choices')>()),
      visibleVizChoices: () => [choice('ok', 'fine'), choice('long', 'g'.repeat(401)), choice('x'.repeat(65))],
    }))
    const { vizCatalog: limited } = await import('./viz-catalog')
    expect(limited().map((entry) => entry.id)).toEqual(['ok'])
  })

  async function catalogWithGooglePlugin(map: unknown) {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} }, map } }))
    const viz = await import('@veodyn/viz')
    viz.registerVisualization({
      apiVersion: viz.PLUGIN_API_VERSION,
      type: 'TEST_GOOGLE_MAP',
      displayName: 'Google map',
      icon: () => null,
      defaultOptions: {},
      Renderer: () => null,
      mapProvider: 'google',
      choices: [{ id: 'google-map', label: 'Google map', options: {}, Thumbnail: () => null }],
    })
    const { vizCatalog: built } = await import('./viz-catalog')
    return built().map((entry) => entry.id)
  }

  it('catalog_leaves_out_a_choice_whose_map_provider_is_not_enabled', async () => {
    expect(await catalogWithGooglePlugin({ providers: [{ id: 'maplibre' }] })).not.toContain('google-map')
  })

  it('catalog_offers_the_choice_when_its_provider_is_enabled', async () => {
    expect(await catalogWithGooglePlugin({ providers: [{ id: 'maplibre' }, { id: 'google' }] })).toContain('google-map')
  })

  it('catalog_offers_every_choice_when_the_instance_names_no_providers', async () => {
    expect(await catalogWithGooglePlugin({})).toContain('google-map')
  })

  it('sends_at_most_the_sidecars_catalog_size', async () => {
    vi.resetModules()
    vi.doMock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} } } }))
    vi.doMock('@/lib/viz-choices', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/lib/viz-choices')>()),
      visibleVizChoices: () =>
        Array.from({ length: 70 }, (_, index) => ({
          id: `c${index}`,
          label: 'c',
          type: 'TABLE',
          options: {},
          Thumbnail: null,
        })),
    }))
    const { vizCatalog: many } = await import('./viz-catalog')
    expect(many()).toHaveLength(60)
  })
})
