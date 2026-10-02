import { describe, expect, it, vi } from 'vitest'
import { CORE_CHOICE_GUIDES } from '@/lib/visualizations/choice-guides'

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
