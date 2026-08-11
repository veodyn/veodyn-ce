// A bubble chart is a scatter plus a size channel, and the size channel is the
// half with no failure mode of its own: drop it and the chart still draws, still
// has both axes, and still looks finished. It just answers a different question
// than the one that was stored. So these cases read the drawn mark's radius
// rather than asserting that something rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { resolveChartConfig } from './resolve-config'
import { ScatterChart } from './scatter-chart'

// recharts draws nothing until it measures a positive width and height, which
// jsdom never reports on its own.
//
// Per element, not one rect for everything, which is the trap: a mock that
// answers 400px for every element has the legend measure itself as the entire
// plot height, and recharts subtracts the whole drawing area away. Every case
// then fails with zero marks, including the ones that have nothing wrong with
// them. See line-area-chart.combo.test.tsx, where it was first paid for.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const height = this.classList.contains('recharts-legend-wrapper') ? 24 : 400
    return {
      width: 800,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: 800,
      x: 0,
      y: 0,
      toJSON() {
        return this
      },
    } as DOMRect
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// The size column sits BEFORE the y column here on purpose. Column order is
// what y inference walks, so if the size column were ever left in that pool it
// would not merely join the y series, it would become the first one and take
// over the y axis. Ordered the other way round, that regression would hide.
const columns: QueryResultData['columns'] = [
  { name: 'at', friendly_name: 'At', type: 'integer' },
  { name: 'weight', friendly_name: 'Weight', type: 'integer' },
  { name: 'value', friendly_name: 'Value', type: 'integer' },
]

// A zero weight leads, because zero is the value with something to prove: it has
// to still draw a point. Rows ascend by weight so the drawn radii come back in
// the order the assertions read them.
const rows = [
  { at: 1, weight: 0, value: 10 },
  { at: 2, weight: 1, value: 20 },
  { at: 3, weight: 2, value: 30 },
  { at: 4, weight: 4, value: 40 },
]

const data: QueryResultData = { columns, rows }

function bubble(columnMapping: Record<string, string>): MockVisualization {
  return {
    id: 1,
    type: 'CHART',
    name: 'Bubble',
    description: '',
    options: { globalSeriesType: 'bubble', columnMapping },
    created_at: '2026-07-21T00:00:00Z',
    updated_at: '2026-07-21T00:00:00Z',
  } as MockVisualization
}

function renderChart(result: QueryResultData, columnMapping: Record<string, string>): HTMLElement {
  const config = resolveChartConfig(bubble(columnMapping), result)
  const { container } = render(
    <ScatterChart config={config} data={result} patterns={DEFAULT_DISPLAY_PATTERNS} />
  )
  return container
}

function renderBubble(
  columnMapping: Record<string, string>,
  ownRows: Record<string, unknown>[] = rows
): HTMLElement {
  return renderChart({ columns, rows: ownRows }, columnMapping)
}

// A second query result with nothing in it called `weight`, and one column that
// is, carrying values that run the OTHER way. Every case built on the fixture
// above names its size column `weight`, so `dataKey="weight"` written straight
// into the renderer would satisfy all of them, while a real Redash chart, whose
// size column is called whatever the query calls it, drew the wrong sizes. Here
// that hardcoding does not merely lose the channel, it inverts it, so the
// failure is a reversed ordering rather than an absence that a fallback could
// be mistaken for.
const otherNames: QueryResultData = {
  columns: [
    { name: 'ts', friendly_name: 'Ts', type: 'integer' },
    { name: 'trips', friendly_name: 'Trips', type: 'integer' },
    { name: 'pop_density', friendly_name: 'Pop density', type: 'float' },
    { name: 'weight', friendly_name: 'Weight', type: 'integer' },
  ],
  rows: [
    { ts: 1, trips: 10, pop_density: 1, weight: 4 },
    { ts: 2, trips: 20, pop_density: 2, weight: 2 },
    { ts: 3, trips: 40, pop_density: 4, weight: 1 },
  ],
}

// recharts draws each point as a d3 circle symbol, whose path opens at
// `M{radius},0`. That radius is the only place the size channel becomes
// observable: jsdom does no layout, so there is no measured geometry to read,
// and the size lands in the path data rather than in an attribute of its own.
function markRadii(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('.recharts-symbols')).map((mark) => {
    const d = mark.getAttribute('d') ?? ''
    const radius = /^M\s*(-?[\d.]+)/.exec(d)?.[1]
    if (radius == null) throw new Error(`Not a circle symbol path: "${d}"`)
    return Number(radius)
  })
}

// The renderer declares its size channel in square pixels of AREA, which is the
// unit recharts wants and the quantity the eye actually compares between two
// discs. Repeated here rather than imported, so a range edited in the renderer
// has to be edited deliberately here too instead of the assertions following it
// silently. The small end is the 64px mark a plain scatter already draws, which
// is why one constant answers both for the floor of the scale and for the size
// of an unsized point.
const MIN_AREA = 64
const MAX_AREA = 1024
const areaOf = (radius: number) => Math.PI * radius ** 2

const SMALLEST = Math.sqrt(MIN_AREA / Math.PI)
const LARGEST = Math.sqrt(MAX_AREA / Math.PI)

const ascending = (radii: number[]) => [...radii].sort((a, b) => a - b)

describe('bubble size channel', () => {
  it('sizes every mark by the column mapped to size', () => {
    const radii = markRadii(renderBubble({ at: 'x', value: 'y', weight: 'size' }))

    expect(radii).toHaveLength(rows.length)
    // Four rows, four weights, four distinct marks, biggest weight biggest
    // mark. A chart that drew the scatter and ignored the size column comes
    // back with four EQUAL radii here, which is what shipped before this.
    expect(new Set(radii).size).toBe(rows.length)
    expect(radii).toEqual(ascending(radii))
    // Both ends of the declared range are really reached, so a size channel
    // that varies but drifts out of legible sizes fails rather than passing on
    // the ordering alone. The floor doubles as the promise that a row whose
    // weight is 0 still draws a mark rather than vanishing.
    expect(radii[0]).toBeCloseTo(SMALLEST, 2)
    expect(radii[radii.length - 1]).toBeCloseTo(LARGEST, 2)
  })

  // Zero anchoring, which the case above cannot see: its smallest weight IS
  // zero, so a scale running from the smallest weight present would put that
  // row on the floor too and look identical. Here the smaller weight is half
  // the larger, so a zero-anchored scale owes it half the area range, while a
  // dataMin-anchored one would hand it the floor and redraw a 5-vs-10 spread
  // as though it were a 0-vs-10 one.
  it('scales mark area from zero, not from the smallest value present', () => {
    const radii = markRadii(
      renderBubble({ at: 'x', value: 'y', weight: 'size' }, [
        { at: 1, weight: 5, value: 10 },
        { at: 2, weight: 10, value: 20 },
      ])
    )

    expect(areaOf(radii[1])).toBeCloseTo(MAX_AREA, 0)
    expect(areaOf(radii[0])).toBeCloseTo((MIN_AREA + MAX_AREA) / 2, 0)
  })

  // A bubble that mapped no size column is a scatter, and was already drawn
  // faithfully. Adding the channel must not cost it its marks or resize them.
  it('draws a bubble with no size column as plain, evenly sized points', () => {
    const radii = markRadii(renderBubble({ at: 'x', value: 'y' }))

    expect(radii).toHaveLength(rows.length)
    expect(new Set(radii).size).toBe(1)
    expect(radii[0]).toBeCloseTo(SMALLEST, 2)
  })

  // The size column is a third channel, not a third series. It is numeric and
  // unmapped to y, so the y inference would happily plot it as well, sizing the
  // points by a column it was also drawing as the y axis.
  it('keeps the size column out of the y series it is inferring', () => {
    const config = resolveChartConfig(bubble({ at: 'x', weight: 'size' }), data)

    expect(config.sizeCol).toBe('weight')
    expect(config.effectiveYCols).toEqual(['value'])
  })

  // And with y left to inference the chart still sizes its marks, so the
  // exclusion above removed the column from one channel without removing it
  // from the other.
  it('still sizes the marks when y is inferred rather than mapped', () => {
    const radii = markRadii(renderBubble({ at: 'x', weight: 'size' }))

    expect(new Set(radii).size).toBe(rows.length)
    expect(radii[radii.length - 1]).toBeCloseTo(LARGEST, 2)
  })

  // The size channel reads the MAPPED column, whatever it is called. Redash
  // names it after the query, so a renderer that reached for one fixed name
  // would work on this suite and nowhere else. See otherNames above for why the
  // fixture carries a decoy `weight` running the opposite way.
  it('sizes marks by the mapped column even when it is not called weight', () => {
    const mapping = { ts: 'x', trips: 'y', pop_density: 'size' }

    expect(resolveChartConfig(bubble(mapping), otherNames).sizeCol).toBe('pop_density')

    const radii = markRadii(renderChart(otherNames, mapping))
    expect(radii).toHaveLength(otherNames.rows.length)
    expect(radii).toEqual(ascending(radii))
    // Sized by pop_density (1, 2, 4) the marks climb to the ceiling and the
    // first one sits a quarter of the way up the range. Sized by `weight`
    // (4, 2, 1) they would climb the other way from exactly these three areas,
    // which the ordering assertion above catches and this one confirms.
    expect(areaOf(radii[0])).toBeCloseTo(MIN_AREA + (MAX_AREA - MIN_AREA) / 4, 0)
    expect(radii[radii.length - 1]).toBeCloseTo(LARGEST, 2)
  })

  // The stale mapping. A query stops selecting the size column and the stored
  // visualization keeps naming it, which is the failure this whole module of
  // validators exists for. recharts hands every point the fallback mark, so the
  // drawing is a plain scatter either way; what must not survive is the config
  // claiming a size channel it is not drawing, because the note the reader gets
  // is written from the mapping, not from the marks.
  it('drops a size column the result no longer has', () => {
    const mapping = { at: 'x', value: 'y', old_weight: 'size' }

    expect(resolveChartConfig(bubble(mapping), data).sizeCol).toBeUndefined()

    const radii = markRadii(renderBubble(mapping))
    expect(radii).toHaveLength(rows.length)
    expect(new Set(radii).size).toBe(1)
    expect(radii[0]).toBeCloseTo(SMALLEST, 2)
  })

  // A negative value has no area to be, and recharts cannot be told to ignore
  // one: its ZAxis hardcodes allowDataOverflow to false, so the zero anchor
  // above quietly becomes dataMin, and an exact 0 is separately read as "no z
  // value" and given the floor. Sizes of -10, -1, 0 and 1 rendered as areas of
  // 64, 849, 64 and 1024 on the installed recharts: the -1 nearly the largest
  // mark, the 0 the smallest. The column is refused instead, and the chart is
  // the plain scatter it can honestly draw.
  it('refuses to size marks by a column holding a negative value', () => {
    const negative = [
      { at: 1, weight: -10, value: 10 },
      { at: 2, weight: -1, value: 20 },
      { at: 3, weight: 0, value: 30 },
      { at: 4, weight: 1, value: 40 },
    ]
    const result: QueryResultData = { columns, rows: negative }

    expect(resolveChartConfig(bubble({ at: 'x', value: 'y', weight: 'size' }), result).sizeCol)
      .toBeUndefined()

    const radii = markRadii(renderBubble({ at: 'x', value: 'y', weight: 'size' }, negative))
    expect(radii).toHaveLength(negative.length)
    expect(new Set(radii).size).toBe(1)
    expect(radii[0]).toBeCloseTo(SMALLEST, 2)

    // Refused as a size channel, still claimed by the size slot. Letting it
    // fall back into the y inference would trade one channel quietly missing
    // for a series quietly invented, and this column would take the y axis.
    expect(resolveChartConfig(bubble({ at: 'x', weight: 'size' }), result).effectiveYCols)
      .toEqual(['value'])
  })
})
