import { describe, expect, it } from 'vitest'
import { PLUGIN_API_VERSION, type VisualizationPlugin } from './plugin'
import { getVisualization } from './registry'
import { registerPlugins } from './register-plugins'

function plugin(type: string): VisualizationPlugin {
  return {
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: type,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
  }
}

describe('registerPlugins', () => {
  it('registers every plugin in the list', () => {
    const plugins = [plugin('TEST_RP_A'), plugin('TEST_RP_B')]

    registerPlugins(plugins)

    expect(getVisualization('TEST_RP_A')).toBe(plugins[0])
    expect(getVisualization('TEST_RP_B')).toBe(plugins[1])
  })

  it('registers the same list once however often it is passed', () => {
    const plugins = [plugin('TEST_RP_SAME')]

    registerPlugins(plugins)

    expect(() => registerPlugins(plugins)).not.toThrow()
  })

  it('accepts a fresh list holding plugins it already registered', () => {
    const shared = plugin('TEST_RP_FRESH')

    registerPlugins([shared])

    expect(() => registerPlugins([shared, plugin('TEST_RP_FRESH_EXTRA')])).not.toThrow()
    expect(getVisualization('TEST_RP_FRESH_EXTRA')).toBeDefined()
  })

  it('still refuses a different list claiming a registered type', () => {
    registerPlugins([plugin('TEST_RP_CLASH')])

    expect(() => registerPlugins([plugin('TEST_RP_CLASH')])).toThrow(/already registered/)
  })
})
