import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVisualization, listVisualizations } from '@/lib/visualizations'
import { isRenderableComponent } from '@/test/component-shape'
import {
  DEFAULT_VIZ_ID,
  VIZ_CHOICES,
  adhocVizFor,
  resolveVizChoice,
  visibleVisualizations,
  visibleVizChoices,
} from '@/lib/viz-choices'

describe('viz choices', () => {
  // The guard against a tile that names a visualization no renderer can build:
  // a choice is only ever a Redash type plus options, never a type of its own.
  it('resolves every choice to a real visualization type', () => {
    const types = new Set(listVisualizations().map((plugin) => plugin.type))
    for (const choice of VIZ_CHOICES) {
      expect(types, `${choice.id} names an unknown type`).toContain(choice.type)
    }
  })

  it('offers the eleven types with the chart shapes broken out', () => {
    expect(VIZ_CHOICES).toHaveLength(15)
    const shapes = VIZ_CHOICES.filter((choice) => choice.type === 'CHART')
    expect(shapes.map((choice) => choice.options.globalSeriesType)).toEqual([
      'line',
      'bar',
      'area',
      'pie',
      'scatter',
    ])
  })

  it('gives every choice a distinct id and label', () => {
    expect(new Set(VIZ_CHOICES.map((choice) => choice.id)).size).toBe(VIZ_CHOICES.length)
    expect(new Set(VIZ_CHOICES.map((choice) => choice.label)).size).toBe(VIZ_CHOICES.length)
  })

  it('carries the chart shape as an option rather than as a type', () => {
    expect(adhocVizFor('chart-bar')).toEqual({
      type: 'CHART',
      name: 'Bar',
      options: { globalSeriesType: 'bar' },
    })
  })

  it('starts on the table, which needs no options', () => {
    expect(resolveVizChoice(DEFAULT_VIZ_ID).type).toBe('TABLE')
    expect(adhocVizFor(DEFAULT_VIZ_ID)).toEqual({ type: 'TABLE', name: 'Table', options: {} })
  })

  // A draft can outlive the build that wrote it, and answering a stale id with
  // the plainest visualization beats taking the editor down.
  it('answers an unknown id with the table rather than throwing', () => {
    expect(resolveVizChoice('no-such-choice').id).toBe(DEFAULT_VIZ_ID)
  })
})

describe('the instance allowlist', () => {
  afterEach(() => vi.restoreAllMocks())

  it('offers everything when no allowlist is configured', () => {
    expect(visibleVizChoices(null)).toEqual(VIZ_CHOICES)
    expect(visibleVizChoices(undefined)).toEqual(VIZ_CHOICES)
    expect(visibleVizChoices({})).toEqual(VIZ_CHOICES)
    expect(visibleVisualizations(null)).toEqual(listVisualizations())
  })

  it('keeps only the types the allowlist names', () => {
    expect(visibleVisualizations({ enabled: ['TABLE', 'MAP'] }).map((plugin) => plugin.type)).toEqual([
      'TABLE',
      'MAP',
    ])
  })

  // The chart shapes are options on one type, so allowing CHART has to bring
  // all five tiles and disallowing it has to take all five away.
  it('filters the builder tiles by the type behind them', () => {
    expect(visibleVizChoices({ enabled: ['TABLE', 'CHART'] }).map((choice) => choice.id)).toEqual([
      'table',
      'chart-line',
      'chart-bar',
      'chart-area',
      'chart-pie',
      'chart-scatter',
    ])
    expect(visibleVizChoices({ enabled: ['TABLE'] }).map((choice) => choice.id)).toEqual(['table'])
  })

  // Guards the shortcut `enabled?.length ? enabled : null`, which would turn an
  // operator's "offer nothing" into "offer everything".
  it('treats an empty allowlist as nothing offered, not everything', () => {
    expect(visibleVizChoices({ enabled: [] })).toEqual([])
    expect(visibleVisualizations({ enabled: [] })).toEqual([])
  })

  // Rolling back to an image without a plugin has to degrade the UI, not stop
  // the app: the name is dropped, and it is reported once rather than on every
  // render of every picker.
  it('warns once for a name no plugin registers, and ignores it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(
      visibleVizChoices({ enabled: ['TABLE', 'NOT_IN_THIS_BUILD'] }).map((c) => c.id)
    ).toEqual(['table'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('NOT_IN_THIS_BUILD')

    visibleVizChoices({ enabled: ['TABLE', 'NOT_IN_THIS_BUILD'] })
    visibleVisualizations({ enabled: ['NOT_IN_THIS_BUILD'] })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('says nothing about a name it does recognize', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    visibleVisualizations({ enabled: ['TABLE', 'CHART'] })
    expect(warn).not.toHaveBeenCalled()
  })

  // The invariant this whole feature turns on: disabling a type is a rule about
  // CREATION. The lookup the renderer uses stays unfiltered, so a widget saved
  // before an operator disabled its type still draws.
  it('does not touch the lookup a saved visualization renders through', () => {
    expect(visibleVisualizations({ enabled: ['CHART'] }).map((plugin) => plugin.type)).toEqual([
      'CHART',
    ])
    expect(isRenderableComponent(getVisualization('MAP')?.Renderer)).toBe(true)
    // Same for a draft naming a tile the instance no longer offers.
    expect(resolveVizChoice('map').type).toBe('MAP')
  })
})
