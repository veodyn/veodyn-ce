import { describe, expect, it } from 'vitest'
import { PLUGIN_API_VERSION, registerVisualization } from '@/lib/visualizations'
import { adhocVizFor, allVizChoices, resolveVizChoice } from '@/lib/viz-choices'

const LATE_TYPE = 'TEST_LATE_REGISTERED'

describe('a choice registered after this module loaded', () => {
  it('resolves, because the list is read per call rather than frozen', () => {
    expect(resolveVizChoice('late-choice').type).toBe('TABLE')

    registerVisualization({
      apiVersion: PLUGIN_API_VERSION,
      type: LATE_TYPE,
      displayName: 'Late',
      icon: () => null,
      defaultOptions: {},
      Renderer: () => null,
      choices: [
        {
          id: 'late-choice',
          label: 'Late',
          options: { flavour: 'late' },
          Thumbnail: () => null,
          guide: 'A late arrival.',
        },
      ],
    })

    const resolved = resolveVizChoice('late-choice')
    expect(resolved.type).toBe(LATE_TYPE)
    expect(resolved.guide).toBe('A late arrival.')
    expect(allVizChoices().some((choice) => choice.id === 'late-choice')).toBe(true)
    expect(adhocVizFor('late-choice')).toEqual({
      type: LATE_TYPE,
      name: 'Late',
      options: { flavour: 'late' },
    })
  })

  it('still falls back to the table for an id nothing registers', () => {
    expect(resolveVizChoice('chart-hologram').type).toBe('TABLE')
  })
})
