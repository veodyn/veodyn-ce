// A choice registered AFTER viz-choices.ts was first imported must still
// resolve.
//
// The trap this guards: `allVizChoices` was a module-level const, evaluated the
// first time this module was imported. Registration is a side effect of
// importing `@/plugins`, which providers.tsx does LAST among its imports, so
// any module reaching viz-choices.ts earlier in the graph froze the list to the
// core types. A plugin's choice then resolved to the table — which is exactly
// what an uninstalled plugin looks like, so nothing ever pointed at it.
//
// It went unnoticed because no plugin had ever declared a `choices` entry. The
// moment one did, the chat model was offered a shape the frontend then refused
// to draw: the original bug, one layer down. Measured, not theorised — with the
// RIITS pack overlaid and its six types confirmed registered,
// resolveVizChoice('destination-board') returned TABLE.
//
// In its own file because the registry has no unregister and a leaked
// TEST_ type would skew the tile counts asserted in viz-choices.test.ts. Uses a
// synthetic plugin rather than a real pack, so it holds in a clean community
// checkout where src/plugins/ has only the example package.
import { describe, expect, it } from 'vitest'
import { PLUGIN_API_VERSION, registerVisualization } from '@/lib/visualizations'
import { adhocVizFor, allVizChoices, resolveVizChoice } from '@/lib/viz-choices'

const LATE_TYPE = 'TEST_LATE_REGISTERED'

describe('a choice registered after this module loaded', () => {
  it('resolves, because the list is read per call rather than frozen', () => {
    // The import above is the hostile order: viz-choices.ts has already
    // evaluated by the time anything registers below.
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
    // The other reader of the same list, used for an ad hoc run.
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
