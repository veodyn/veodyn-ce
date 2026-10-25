import { describe, expect, it } from 'vitest'
import '..'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from '../plugin'
import { authoringFor, registerVisualization } from '../registry'
import { CORE_AUTHORING } from './core-authoring'
import { describeAuthoring } from './describe'
import type { AuthoringSchema } from './types'

const TICKER_AUTHORING: AuthoringSchema = {
  symbol: { rule: 'string', description: 'Ticker symbol to show.' },
  refreshSeconds: { rule: 'number', description: 'Seconds between refreshes.' },
}

function plugin(type: string, authoringOptions?: AuthoringSchema): VisualizationPlugin {
  return {
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: `Plugin ${type}`,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
    authoringOptions,
  }
}

describe('authoringFor', () => {
  it('returns the core declaration', () => {
    expect(authoringFor('CHART')).toBe(CORE_AUTHORING.CHART)
  })

  it('returns a registered plugin declaration', () => {
    registerVisualization(plugin('AUTHORING_FOR_TICKER', TICKER_AUTHORING))
    expect(authoringFor('AUTHORING_FOR_TICKER')).toBe(TICKER_AUTHORING)
  })

  it('returns null for a plugin that declares nothing', () => {
    registerVisualization(plugin('AUTHORING_FOR_BARE'))
    expect(authoringFor('AUTHORING_FOR_BARE')).toBeNull()
  })

  it('returns null for an unknown type', () => {
    expect(authoringFor('AUTHORING_FOR_MISSING')).toBeNull()
  })

  it('describes a plugin type with its display name', () => {
    registerVisualization(plugin('AUTHORING_FOR_DESCRIBED', TICKER_AUTHORING))
    const described = describeAuthoring('AUTHORING_FOR_DESCRIBED')
    expect(described?.label).toBe('Plugin AUTHORING_FOR_DESCRIBED')
    expect(described?.options.map((o) => o.key)).toEqual(['symbol', 'refreshSeconds'])
  })
})
