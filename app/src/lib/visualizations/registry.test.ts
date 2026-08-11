import { describe, expect, it } from 'vitest'
import { isRenderableComponent } from '@/test/component-shape'
import {
  CORE_VISUALIZATIONS,
  getVisualization,
  listVisualizations,
  PLUGIN_API_VERSION,
  registerVisualization,
  registeredTypes,
  registeredVisualizations,
  visualizationLabel,
  visualizationOrigin,
  type VisualizationPlugin,
} from '@/lib/visualizations'

function fakePlugin(type: string, over: Partial<VisualizationPlugin> = {}): VisualizationPlugin {
  return {
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: type,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
    ...over,
  }
}

describe('visualization registry', () => {
  it('registers every core visualization', () => {
    expect(registeredTypes()).toEqual(CORE_VISUALIZATIONS.map((p) => p.type))
  })

  // The whole point of the registry. Before it, four types had a renderer and
  // no entry anywhere else, so they drew but could not be created. Asserting
  // over the registry rather than a hand-written list is deliberate: a copy of
  // the list here would be a sixth place to drift.
  it('gives every registered type a renderer and a unique name', () => {
    const seen = new Set<string>()
    for (const plugin of CORE_VISUALIZATIONS) {
      expect(isRenderableComponent(plugin.Renderer), `${plugin.type} has no Renderer`).toBe(true)
      expect(seen.has(plugin.type), `${plugin.type} registered twice`).toBe(false)
      seen.add(plugin.type)
    }
  })

  it('gives every builder-offered type an editor', () => {
    for (const plugin of CORE_VISUALIZATIONS) {
      if (!plugin.choices?.length) continue
      expect(isRenderableComponent(plugin.Editor), `${plugin.type} is pickable but has no Editor`).toBe(true)
    }
  })

  it('keeps builder choice ids unique across plugins', () => {
    const ids = CORE_VISUALIZATIONS.flatMap((p) => p.choices ?? []).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('rejects a plugin built against a different interface version', () => {
    expect(() =>
      registerVisualization(fakePlugin('TEST_STALE', { apiVersion: PLUGIN_API_VERSION + 1 }))
    ).toThrow(/API version/)
  })

  it('refuses to let a plugin shadow an existing type', () => {
    registerVisualization(fakePlugin('TEST_DUPLICATE'))
    expect(() => registerVisualization(fakePlugin('TEST_DUPLICATE'))).toThrow(/already registered/)
  })

  describe('listVisualizations', () => {
    it('returns everything when no allowlist is configured', () => {
      expect(listVisualizations(null).length).toBeGreaterThanOrEqual(CORE_VISUALIZATIONS.length)
      expect(listVisualizations(undefined)).toEqual(listVisualizations(null))
    })

    it('filters to the allowlist, preserving registration order', () => {
      expect(listVisualizations(['MAP', 'TABLE', 'CHART']).map((p) => p.type)).toEqual([
        'TABLE',
        'CHART',
        'MAP',
      ])
    })

    it('ignores an allowlisted type this build does not have', () => {
      // Rolling back to an image without some plugin should degrade the UI,
      // not refuse to boot.
      expect(listVisualizations(['TABLE', 'NOT_IN_THIS_BUILD']).map((p) => p.type)).toEqual(['TABLE'])
    })
  })

  // A choropleth joins on feature.properties[targetField]. Seeding it in
  // defaultOptions only helps a NEW visualization, so the ones saved before
  // that default existed still match zero regions while the renderer blames
  // the key column. validate is what reaches them.
  it('tells an existing choropleth that its map property is unset', () => {
    const data = {
      columns: [{ name: 'code', friendly_name: 'code', type: 'string' }],
      rows: [{ code: 'FJ' }],
    }
    const choropleth = getVisualization('CHOROPLETH')

    expect(choropleth?.validate?.({ keyColumn: 'code' }, data)).toEqual([
      'No map property is selected, so no region can match. Pick one under "Matched Against".',
    ])
    expect(choropleth?.validate?.({ keyColumn: 'code', targetField: 'name' }, data)).toEqual([])
  })

  describe('getVisualization', () => {
    it('resolves a registered type', () => {
      expect(getVisualization('MAP')?.displayName).toBe('Map (Markers)')
    })

    it('returns undefined for an unknown type rather than throwing', () => {
      expect(getVisualization('NOPE')).toBeUndefined()
    })
  })

  // Origin is what the admin plugins page reports and what decides whether a
  // name reads as Plugin[...]. It is not a capability: nothing here gates
  // rendering, and a plugin type does everything a core one does.
  describe('origin', () => {
    it('marks the types that ship with the product as core', () => {
      expect(visualizationOrigin('TABLE')).toBe('core')
      expect(visualizationLabel('TABLE')).toBe('Table')
    })

    // The default is the load-bearing part: core is the only caller that can
    // honestly pass 'core', so anything registering from outside has to come
    // out as a plugin without having to say so.
    it('defaults an outside registration to plugin, and names it as one', () => {
      registerVisualization(fakePlugin('TEST_ORIGIN', { displayName: 'Ticker' }))
      expect(visualizationOrigin('TEST_ORIGIN')).toBe('plugin')
      expect(visualizationLabel('TEST_ORIGIN')).toBe('Plugin[Ticker]')
    })

    it('says nothing about a type nothing registered', () => {
      expect(visualizationOrigin('NOPE')).toBeUndefined()
      // The same string the renderer prints for an unsupported type, so the
      // two surfaces cannot describe the same visualization differently.
      expect(visualizationLabel('NOPE')).toBe('NOPE')
    })

    // The admin page reads this instead of a build manifest, so it has to
    // cover the whole registry rather than a curated part of it.
    it('reports every registered type, in registration order', () => {
      const entries = registeredVisualizations()
      expect(entries.map((entry) => entry.plugin.type)).toEqual(registeredTypes())
      expect(entries.filter((entry) => entry.origin === 'core').map((e) => e.plugin.type)).toEqual(
        CORE_VISUALIZATIONS.map((plugin) => plugin.type)
      )
    })
  })
})
