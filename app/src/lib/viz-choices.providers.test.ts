import { describe, expect, it } from 'vitest'
import { PLUGIN_API_VERSION, registerVisualization, type VisualizationPlugin } from '@veodyn/viz'
import { allVizChoices, visibleVizChoices } from '@/lib/viz-choices'

function plugin(type: string, over: Partial<VisualizationPlugin> = {}): VisualizationPlugin {
  return {
    apiVersion: PLUGIN_API_VERSION,
    type,
    displayName: type,
    icon: () => null,
    defaultOptions: {},
    Renderer: () => null,
    choices: [{ id: `${type.toLowerCase()}-choice`, label: type, options: {}, Thumbnail: () => null }],
    ...over,
  }
}

registerVisualization(plugin('TEST_NEEDS_GOOGLE', { mapProvider: 'google' }))
registerVisualization(plugin('TEST_NEEDS_NOTHING'))
registerVisualization(
  plugin('TEST_TAGGED', {
    choices: [{ id: 'tagged-choice', label: 'Tagged', options: {}, Thumbnail: () => null, libraryTag: 'live-map' }],
  })
)

const ids = (visibility?: Parameters<typeof visibleVizChoices>[0]) => visibleVizChoices(visibility).map((c) => c.id)

describe('map providers and choice visibility', () => {
  it('choice_needing_disabled_provider_is_hidden', () => {
    expect(ids({ mapProviders: ['maplibre'] })).not.toContain('test_needs_google-choice')
  })

  it('shows_the_choice_once_its_provider_is_enabled', () => {
    expect(ids({ mapProviders: ['maplibre', 'google'] })).toContain('test_needs_google-choice')
  })

  it('shows_every_choice_when_the_instance_names_no_providers', () => {
    expect(ids({ mapProviders: undefined })).toContain('test_needs_google-choice')
    expect(ids()).toContain('test_needs_google-choice')
  })

  it('never_hides_a_choice_that_needs_no_provider', () => {
    expect(ids({ mapProviders: ['maplibre'] })).toContain('test_needs_nothing-choice')
    expect(ids({ mapProviders: [] })).toContain('table')
  })

  it('keeps_the_saved_lookup_unfiltered', () => {
    expect(allVizChoices().map((c) => c.id)).toContain('test_needs_google-choice')
  })
})

describe('library tag on a choice', () => {
  it('libraryTag_reaches_the_visible_choice', () => {
    expect(visibleVizChoices().find((c) => c.id === 'tagged-choice')?.libraryTag).toBe('live-map')
  })

  it('choices_without_a_tag_carry_none', () => {
    expect(visibleVizChoices().find((c) => c.id === 'table')).not.toHaveProperty('libraryTag')
  })
})
