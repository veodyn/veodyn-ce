// What the chat model is allowed to ask for.
//
// The API cannot work this out for itself: its shape list was hand-copied from
// viz-choices.ts, and the sidecar image does not install a pack, so a pack's
// visualization was unnameable and clamped to a table. This is the half that
// knows the truth.
import { describe, expect, it, vi } from 'vitest'
import { CORE_CHOICE_GUIDES } from '@/lib/visualizations/choice-guides'

vi.mock('@/lib/config', () => ({ config: { visualizations: { enabled: null, audience: {} } } }))

const { vizCatalog } = await import('./viz-catalog')

describe('vizCatalog', () => {
  it('offers the core shapes with the type each one produces', () => {
    const byId = new Map(vizCatalog().map((entry) => [entry.id, entry]))
    expect(byId.get('table')?.type).toBe('TABLE')
    expect(byId.get('map')?.type).toBe('MAP')
    // A chart shape is a CHART option, not a type of its own. The API needs the
    // type to store the visualization and the id to talk to the model.
    expect(byId.get('chart-bar')?.type).toBe('CHART')
    expect(byId.get('chart-line')?.type).toBe('CHART')
  })

  it('carries the guide that tells the model when to pick a shape', () => {
    const map = vizCatalog().find((entry) => entry.id === 'map')
    expect(map?.guide).toBe(CORE_CHOICE_GUIDES.map)
    // The aliasing instruction is load-bearing: the MAP renderer has no
    // positional fallback, so coordinates under an unusual name draw nothing.
    expect(map?.guide).toContain('`lat`')
  })

  it('leaves the guide off a shape nobody wrote one for', () => {
    // A choice with no sentence is still offered; the API lists it under its
    // label. Omitted rather than sent empty so the wire says which is which.
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
