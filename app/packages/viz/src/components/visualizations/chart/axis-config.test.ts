import { describe, expect, it } from 'vitest'
import type { ResolvedChartConfig } from './resolve-config'
import {
  AXIS_LINE,
  AXIS_TICK,
  BASELINE_VALUE_DOMAIN,
  GRID,
  headroomDomain,
  INDEXED_AXIS_LABEL_TEXT,
  indexedYAxisLabel,
  referenceLinesFor,
  Y_AXIS_HEADROOM,
  yAxisPropsFor,
} from './axis-config'

function configWithYAxis(
  yAxis: ResolvedChartConfig['yAxis'],
): ResolvedChartConfig {
  return {
    chartType: 'line',
    xCol: 'date',
    yRightCols: [],
    effectiveYCols: ['value'],
    indexed: false,
    stacking: 'disabled',
    xIsDatetime: true,
    xHasTime: false,
    swappedAxes: false,
    reverseX: false,
    showDataLabels: false,
    donut: false,
    seriesOptions: {},
    yAxis,
    referenceLines: [],
  }
}

// Where the highest mark lands in the plot, as a share of the drawn height.
// The headroom is defined in terms of this, not of the numbers: 20% more axis
// than the data needs puts the peak at 1/1.2 of the way up whatever the
// magnitudes are, which is the whole point of measuring from the floor.
function peakHeight(dataDomain: [number, number]): number {
  const [floor, ceiling] = headroomDomain(dataDomain, 'linear')
  return (dataDomain[1] - floor) / (ceiling - floor)
}

describe('headroomDomain', () => {
  it('leaves the highest mark a fifth of the plot short of the ceiling', () => {
    // The whole point: the topmost mark must not sit on the plot's ceiling,
    // where it reads as pinned against the frame and cannot be told apart
    // from a peak the frame cut off.
    expect(peakHeight([0, 100])).toBeCloseTo(1 / (1 + Y_AXIS_HEADROOM), 6)
  })

  it('leaves the same share of the plot free whatever the magnitudes are', () => {
    // A fifth of the span between the two extremes would not do this: on a
    // series of 4.8K..22.3K it gets swallowed by the stretch down to the 0
    // baseline and the peak ends up back against the frame.
    for (const dataDomain of [[4_800, 22_300], [88.1, 91.9], [0.2, 3.4], [-100, -20], [-50, 50]] as [number, number][]) {
      expect(peakHeight(dataDomain)).toBeCloseTo(1 / (1 + Y_AXIS_HEADROOM), 6)
    }
  })

  it('keeps the floor recharts would have drawn, rather than starting at the lowest value', () => {
    // Headroom is added at the top only. The floor still comes from recharts'
    // own tick algorithm, so a series that ran from 4.8K keeps the round
    // baseline it has always had instead of being truncated to its own
    // minimum, which is also what keeps bars and areas whole.
    const [floor] = headroomDomain([4_800, 22_300], 'linear')

    expect(floor).toBeLessThanOrEqual(4_800)
    expect(floor).toBe(4_500)
  })

  it('pads a log axis in log space, so decades do not swallow the headroom', () => {
    // An additive fifth-of-the-span pad is nearly invisible on a log axis:
    // 1..1000 would reach 1199, a fifteenth of a decade. The pad is
    // multiplicative instead, so it reads the same at every magnitude.
    const [, ceiling] = headroomDomain([1, 1_000], 'log')

    expect(ceiling).toBeCloseTo(1_000 * 1_000 ** Y_AXIS_HEADROOM, 6)
  })

  it('leaves a log domain that touches zero alone, since it has no log span', () => {
    // Zero has no log coordinate, so there is no span to take a share of.
    expect(headroomDomain([0, 100], 'log')).toEqual([0, 100])
  })

  it('does not collapse a flat series onto a single point', () => {
    // Every value equal means no span of its own to measure against, so the
    // headroom is a share of the distance to the floor recharts spread around
    // that single value.
    const [floor, ceiling] = headroomDomain([50, 50], 'linear')

    expect(ceiling).toBeGreaterThan(50)
    expect(floor).toBeLessThan(50)
  })

  it('leaves a flat zero series to recharts rather than returning no scale at all', () => {
    // A series of nothing but zeroes gets a floor of 0 from the tick
    // algorithm, and a fifth of the zero distance between the two is still
    // zero. Returning [0, 0] would be an axis with no extent, so the domain
    // recharts computed from the data stands instead.
    expect(headroomDomain([0, 0], 'linear')).toEqual([0, 0])
  })

  it('passes a non-finite domain straight back, so recharts falls back to the data', () => {
    // recharts hands back [Infinity, -Infinity] when nothing numeric was
    // plotted. Returning it unchanged fails its own well-formed-domain check,
    // which is how a domain function says "use the one you computed".
    expect(headroomDomain([Infinity, -Infinity], 'linear')).toEqual([Infinity, -Infinity])
  })
})

describe('yAxisPropsFor', () => {
  it('maps a logarithmic axis and honours its explicit bounds exactly', () => {
    // Hand-set bounds are what the reader asked the axis to show, so they get
    // no headroom on top of them.
    const config = configWithYAxis([
      { type: 'logarithmic', rangeMin: 1, rangeMax: 1_000 },
    ])
    const props = yAxisPropsFor(0, config)

    expect(props.scale).toBe('log')
    expect(props.domain([5, 500])).toEqual([1, 1_000])
  })

  it('gives an axis with only a floor pinned the headroom above it', () => {
    const config = configWithYAxis([{ rangeMin: 0 }])
    const [floor, ceiling] = yAxisPropsFor(0, config).domain([10, 100])

    expect(floor).toBe(0)
    expect(ceiling).toBeGreaterThanOrEqual(100 * (1 + Y_AXIS_HEADROOM))
  })

  it('defaults a missing axis to a linear headroom domain', () => {
    const config = configWithYAxis([])
    const props = yAxisPropsFor(1, config)

    expect(props.scale).toBe('linear')
    expect(props.domain([0, 100])).toEqual(headroomDomain([0, 100], 'linear'))
  })

  it('asks the axis not to re-round the domain it was given', () => {
    // recharts' default is to nice a numeric domain onto its own tick grid,
    // which stretches the ceiling out by up to another whole tick and labels
    // the top of the axis with whatever number that lands on. The headroom is
    // only exact if the domain is left as returned.
    expect(yAxisPropsFor(0, configWithYAxis([])).niceTicks).toBe('none')
  })

  it('hands every render the same domain function when no bound is pinned', () => {
    // recharts compares the domain prop by identity and re-registers the axis
    // when it changes, so a fresh closure per render would buy an extra pass
    // over the data for nothing.
    const config = configWithYAxis([])

    expect(yAxisPropsFor(0, config).domain).toBe(yAxisPropsFor(0, config).domain)
  })

  it('ignores a saved raw rangeMin/rangeMax when the chart is effectively indexed', () => {
    // A chart's yAxis bounds were authored against raw magnitudes (a saved
    // chart bounded to 1,000,000..2,000,000, say). Once a chart indexes its
    // series they live near 100, so honouring the stored bound would put
    // every mark outside its own domain and render the plot blank. There is
    // no correct conversion either, since each series has its own base, so
    // an indexed chart auto-scales instead of trusting the stale bound.
    const config: ResolvedChartConfig = {
      ...configWithYAxis([{ rangeMin: 1_000_000, rangeMax: 2_000_000 }]),
      indexed: true,
    }

    expect(yAxisPropsFor(0, config).domain([90, 110])).toEqual(headroomDomain([90, 110], 'linear'))
  })

  it('forces a linear scale when the chart is effectively indexed, even with a saved logarithmic axis', () => {
    // Indexing preserves zero and can produce negative values (index-series.ts
    // divides by the base's magnitude but keeps the sign), while a log domain
    // cannot cross zero: it has no valid coordinate there. A saved or
    // editor-selected log scale forwarded unchanged into an indexed chart
    // makes every mark and tick vanish, so an indexed chart always renders on
    // a linear scale regardless of what was saved.
    const config: ResolvedChartConfig = {
      ...configWithYAxis([{ type: 'logarithmic' }]),
      indexed: true,
    }

    expect(yAxisPropsFor(0, config).scale).toBe('linear')
  })
})

describe('BASELINE_VALUE_DOMAIN', () => {
  const [floor, ceiling] = BASELINE_VALUE_DOMAIN

  it('keeps the zero baseline a bar grows from', () => {
    // A bar cut off at its own lowest value misstates every comparison the
    // chart exists to make, so this axis does not take the data-derived floor
    // the other value axes do.
    expect(floor).toBe(0)
  })

  it('leaves the longest bar a fifth of the plot short of the far end', () => {
    expect(ceiling(100)).toBeCloseTo(100 * (1 + Y_AXIS_HEADROOM), 6)
  })

  it('reaches no further than the data when every value is negative', () => {
    // Bars pointing the other way get no headroom rather than a domain that
    // stops short of them: recharts extends this back to the data itself.
    expect(ceiling(-100)).toBeLessThanOrEqual(-100)
  })
})

describe('referenceLinesFor', () => {
  it('drops y reference lines but keeps x ones when the chart is effectively indexed', () => {
    // A y reference line was authored against a raw magnitude (a
    // 1,500,000 threshold, say). Once the chart indexes, each series has
    // its own base, so one raw threshold would map to a different indexed
    // value per series: there is no single correct place to draw it, so an
    // indexed chart drops it rather than drawing it in the wrong place. An
    // x reference line marks a position along the x axis, which indexing
    // never touches, so it is unaffected.
    const config: ResolvedChartConfig = {
      ...configWithYAxis([]),
      indexed: true,
      referenceLines: [
        { value: 1_500_000, label: 'y threshold' },
        { value: 5, label: 'x threshold', axis: 'x' },
      ],
    }

    expect(referenceLinesFor(config).map((line) => line.label)).toEqual(['x threshold'])
  })

  it('keeps every reference line when the chart is not indexed', () => {
    const config: ResolvedChartConfig = {
      ...configWithYAxis([]),
      indexed: false,
      referenceLines: [
        { value: 1_500_000, label: 'y threshold' },
        { value: 5, label: 'x threshold', axis: 'x' },
      ],
    }

    expect(referenceLinesFor(config).map((line) => line.label)).toEqual(['y threshold', 'x threshold'])
  })
})

describe('chart chrome constants', () => {
  it('paints tick text with a token, not a literal', () => {
    expect(AXIS_TICK.fill).toMatch(/^var\(--[a-z-]+\)$/)
  })

  it('gives ticks tabular figures, since they stack vertically', () => {
    expect(AXIS_TICK.fontVariantNumeric).toBe('tabular-nums')
  })

  it('draws the axis line as the same hairline as the grid', () => {
    expect(AXIS_LINE.stroke).toBe(GRID.stroke)
  })

  it('drops the per-tick spur, since the label already marks the position', () => {
    expect(AXIS_LINE.tickLine).toBe(false)
  })

  it('draws horizontal rules only', () => {
    expect(GRID.vertical).toBe(false)
  })

  it('defines no dash pattern, so the grid does not read as a threshold', () => {
    expect(GRID).not.toHaveProperty('strokeDasharray')
  })
})

describe('indexedYAxisLabel', () => {
  it('names the scale as an index, not a raw magnitude', () => {
    expect(indexedYAxisLabel().value).toBe(INDEXED_AXIS_LABEL_TEXT)
  })

  it('does not claim every series starts at 100, since a negative-starting series is indexed to -100', () => {
    // index-series.ts divides by the base's magnitude and keeps the sign, so
    // a series that starts negative reads as -100, not 100. The label text
    // must not overstate that as a universal "starts at 100".
    expect(INDEXED_AXIS_LABEL_TEXT).not.toMatch(/every series/i)
    expect(INDEXED_AXIS_LABEL_TEXT).toMatch(/-100/)
  })

  it('paints the label with a token, not a literal', () => {
    expect(indexedYAxisLabel().fill).toMatch(/^var\(--[a-z-]+\)$/)
  })
})
