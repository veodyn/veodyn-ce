import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { resolveSeriesColor } from '@/lib/chart-colors'
import { FILLABLE_PANEL_HEIGHT } from '@/lib/chart-marks'
import { SunburstRenderer, SunburstTooltip } from './sunburst-renderer'

function viz(options: Record<string, unknown>): MockVisualization {
  return { id: 1, type: 'SUNBURST_SEQUENCE', name: 'Sunburst', description: '', options, created_at: '', updated_at: '' }
}

// Two regions of two cities each, and the six totals the tree rolls up to
// (West 15, LA 10, SF 5, East 11, NYC 8, BOS 3) are all distinct. That matters:
// recharts labels each sector with its own value and emits no other per-node
// text, so the label is the only handle a test has on a particular node.
const data: QueryResultData = {
  columns: [
    { name: 'region', friendly_name: 'region', type: 'string' },
    { name: 'city', friendly_name: 'city', type: 'string' },
    { name: 'value', friendly_name: 'value', type: 'integer' },
  ],
  rows: [
    { region: 'West', city: 'LA', value: 10 },
    { region: 'West', city: 'SF', value: 5 },
    { region: 'East', city: 'NYC', value: 8 },
    { region: 'East', city: 'BOS', value: 3 },
  ],
}

// The same result with the city column dropped, so the tree is one level deep.
// Its own fixture because that shape loses the most radius to the undrawn root.
const flat: QueryResultData = {
  columns: [
    { name: 'region', friendly_name: 'region', type: 'string' },
    { name: 'value', friendly_name: 'value', type: 'integer' },
  ],
  rows: [
    { region: 'West', value: 15 },
    { region: 'East', value: 11 },
  ],
}

// recharts draws each sector as a <path> and its label as a sibling <text>
// inside one <g>, so a node is found by the total it is labelled with and its
// own arc read back off the group.
function sectorLabelled(container: HTMLElement, total: string): Element {
  const label = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === total)
  if (!label) throw new Error(`expected a sector labelled "${total}"`)
  const path = label.closest('g')?.querySelector('path')
  if (!path) throw new Error(`expected the sector labelled "${total}" to be drawn as a path`)
  return path
}

function fillOf(container: HTMLElement, total: string): string | null {
  return sectorLabelled(container, total).getAttribute('fill')
}

function attributeOf(container: HTMLElement, selector: string, attribute: string): (string | null)[] {
  return Array.from(container.querySelectorAll(selector)).map((element) => element.getAttribute(attribute))
}

// Every arc inside a sector's `d` is written `A rx,ry,...`, so the radii
// recharts drew read back off the markup, the largest being where the ink stops.
function outermostRadius(container: HTMLElement): number {
  const radii = attributeOf(container, 'path.recharts-sector', 'd').flatMap((d) =>
    Array.from((d ?? '').matchAll(/A (\d+(?:\.\d+)?),/g), (match) => Number(match[1]))
  )
  return Math.max(...radii)
}

// The radius the chart had to spend: half the shorter side of the surface it
// sized for itself. Read off the markup rather than assumed, because jsdom runs
// no layout: the only honest claim is the RELATION between what recharts had and
// what it drew, which holds whatever box a browser gives it.
function availableRadius(container: HTMLElement): number {
  const surface = container.querySelector('svg.recharts-surface')
  return Math.min(Number(surface?.getAttribute('width')), Number(surface?.getAttribute('height'))) / 2
}

afterEach(() => vi.unstubAllGlobals())

describe('SunburstRenderer', () => {
  it('degrades to a muted message when there are no rows', () => {
    render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={{ columns: data.columns, rows: [] }} />)
    expect(screen.getByText(/no data to display/i)).toBeInTheDocument()
  })

  it('renders the no-data state instead of an empty chart when the tree is empty', () => {
    const { container } = render(
      <SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={{ columns: data.columns, rows: [] }} />,
    )
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('degrades rather than drawing equal wedges when every value is zero', () => {
    // recharts scales the angles against the root total, so a zero total sends
    // every sector to the same made-up angle: wedges of identical size that say
    // nothing about a result whose values are all zero.
    const zeroed = { columns: data.columns, rows: data.rows.map((row) => ({ ...row, value: 0 })) }
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={zeroed} />)

    expect(screen.getByText(/no data to display/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('never throws on a fully degraded input with no columns and no rows at all', () => {
    expect(() => render(<SunburstRenderer visualization={viz({})} data={{ columns: [], rows: [] }} />)).not.toThrow()
    render(<SunburstRenderer visualization={viz({})} data={{ columns: [], rows: [] }} />)
    expect(screen.getAllByText(/no data to display/i)[0]).toBeInTheDocument()
  })

  it('draws one sector per non-root node, each with a real arc path', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    const sectors = container.querySelectorAll('path.recharts-sector')

    // West, East, LA, SF, NYC, BOS. The synthetic root is never drawn.
    expect(sectors).toHaveLength(6)
    for (const sector of Array.from(sectors)) {
      expect(sector.getAttribute('d')).toMatch(/^M/)
      expect(sector.getAttribute('d')).not.toContain('NaN')
    }
  })

  it('sums leaf values onto their ancestors, which recharts does not do itself', () => {
    // The d3 layout this replaced ran hierarchy().sum(); recharts sizes each arc
    // from its own value alone, so without the roll-up a region sizes to nothing.
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    const totals = Array.from(container.querySelectorAll('text')).map((t) => t.textContent)

    expect(totals).toContain('15')
    expect(totals).toContain('11')
  })

  it('keeps the accessible name on the box that now owns it', () => {
    // recharts owns the svg and passes it nothing but a size, so the role and
    // label moved out to the wrapper.
    render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    expect(screen.getByRole('img', { name: 'Sunburst' })).toBeInTheDocument()
  })

  // Sizing. jsdom runs no layout engine: every element is 0x0 there and no
  // stylesheet resolves, so a rendered pixel width reads back either zero or the
  // number this component just set. These two assert what makes a browser scale.
  it('sizes the chart as a percentage of its box, not at a fixed pixel square', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    const chart = container.querySelector<HTMLElement>('.recharts-wrapper')

    expect(chart?.style.width).toBe('100%')
    expect(chart?.style.height).toBe('100%')
    // Named separately from the exact values above so a failure says WHICH
    // regression happened: an absolute length, bare number or px, is the shape
    // this renderer had before (a 360px square) and must not go back to.
    const ABSOLUTE_LENGTH = /^\d+(\.\d+)?(px)?$/
    expect(chart?.style.width).not.toMatch(ABSOLUTE_LENGTH)
    expect(chart?.style.height).not.toMatch(ABSOLUTE_LENGTH)
  })

  it('keeps watching its box, so a tile resized after mount redraws', () => {
    // Percentage sizes alone are measured once, at mount, which is not scaling
    // with a tile that changes size afterwards. `responsive` is what puts a
    // ResizeObserver on the box, and constructing one is jsdom's only trace of it.
    const observed: Element[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(target: Element) {
          observed.push(target)
        }
        unobserve() {}
        disconnect() {}
      }
    )

    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)

    expect(observed).toContain(container.querySelector('.recharts-wrapper'))
  })

  it('gives the chart a definite height to resolve against without hardcoding pixels', () => {
    // A percentage height needs a containing block whose height is definite, and
    // that height has to be the shared fill custom property: a surface that opts
    // into filling its space sets it, and a wrapper pinned to 400px ignores it.
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    const box = container.firstElementChild as HTMLElement

    expect(box).toHaveStyle({ height: FILLABLE_PANEL_HEIGHT })
    expect(box.className).not.toMatch(/h-\[\d/)
  })

  // The rings have to reach the edge of the box they were given. recharts
  // divides the radius by the depth of the tree it is handed, and that depth
  // counts the synthetic root it never draws, so an uncorrected sunburst stops
  // one ring short: two thirds of the radius here, half for the flat fixture.
  it('spends the whole radius on rings, rather than the share of a root it never draws', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)

    // Guards against passing on a 0 === 0, which would mean no box was reported.
    expect(availableRadius(container)).toBeGreaterThan(0)
    expect(outermostRadius(container)).toBeCloseTo(availableRadius(container), 4)
  })

  it('spends the whole radius on a single-level tree too, the shape that loses the most', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={flat} />)

    expect(container.querySelectorAll('path.recharts-sector')).toHaveLength(2)
    expect(availableRadius(container)).toBeGreaterThan(0)
    expect(outermostRadius(container)).toBeCloseTo(availableRadius(container), 4)
  })

  it('colors every node from the palette, keyed on the top-level ancestor', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    const fills = attributeOf(container, 'path.recharts-sector', 'fill')
    // As a filtered list rather than an .every(): a bare false says nothing,
    // while this prints whatever colour the sectors fell back to instead.
    expect(fills.filter((fill) => !fill?.startsWith('var(--chart-'))).toEqual([])

    const west = fillOf(container, '15')
    const east = fillOf(container, '11')

    // LA and SF descend from West, so they share West's own hue; NYC and BOS
    // descend from East instead, a different top-level ancestor.
    expect(fillOf(container, '10')).toBe(west)
    expect(fillOf(container, '5')).toBe(west)
    expect(fillOf(container, '8')).toBe(east)
    expect(fillOf(container, '3')).toBe(east)
    expect(west).not.toBe(east)

    // Both hues are real palette slots from resolveSeriesColor (order between
    // West and East is not asserted, only that both come from the shared
    // palette function), not colors the renderer invented.
    const palette = new Set([resolveSeriesColor('a', 0), resolveSeriesColor('b', 1)])
    expect(palette.has(west ?? '')).toBe(true)
    expect(palette.has(east ?? '')).toBe(true)
  })

  // The two checks below read the rendered DOM on purpose. viz-chrome-tokens
  // guards colour by text-scanning this renderer's SOURCE, which can only see a
  // literal somebody typed there; recharts supplies these two as its own
  // defaults, so dropping either override puts a literal in the document that
  // no source scan can reach.
  it('strokes the sectors with a token, not the white recharts defaults to', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    const strokes = attributeOf(container, 'path.recharts-sector', 'stroke')

    expect(strokes).not.toEqual([])
    expect(strokes.filter((stroke) => !stroke?.startsWith('var(--'))).toEqual([])
  })

  it('draws the sector labels in tokens, not recharts black glyphs on a white halo', () => {
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)
    // Both halves of the override: the glyph colour AND the halo behind it,
    // since recharts hardcodes one of each and dropping textOptions brings back
    // the pair.
    const labels = attributeOf(container, 'text.recharts-text', 'fill')
    const halos = attributeOf(container, 'text.recharts-text', 'stroke')

    expect(labels).not.toEqual([])
    expect(labels.filter((fill) => !fill?.startsWith('var(--'))).toEqual([])
    expect(halos.filter((stroke) => !stroke?.startsWith('var(--'))).toEqual([])
  })

  it('wires the tooltip into the chart, so a hovered sector says which node it is', () => {
    // SunburstTooltip renders correctly on its own in the suite below, which
    // says nothing about whether the chart still passes it as Tooltip content.
    // It has to be hovered through the real chart, and that matters more here
    // than elsewhere: the swap gave up the per-sector <title> the hand-drawn
    // arcs carried, so this panel is now the ONLY place a wedge names itself.
    const { container } = render(<SunburstRenderer visualization={viz({ valueColumn: 'value' })} data={data} />)

    fireEvent.mouseOver(sectorLabelled(container, '10'))

    // Read off the panel rather than the document: the hovered node's total is
    // drawn on its sector as well, so a document-wide query for it matches text
    // that would still be there with no tooltip at all.
    const panel = screen.getByText('LA').closest('div.bg-card')
    expect(panel?.textContent).toContain('10')
    expect(panel?.innerHTML).not.toMatch(/rgb\(|#[0-9a-f]{3,6}/i)
  })
})

// The shape recharts hands a tooltip for a hovered sector: SunburstChart's own
// SetSunburstTooltipEntrySettings names it from nameKey and values it from
// dataKey, both defaulted to the fields the model already carries.
function entry(name: string, value: number) {
  return { name, value, dataKey: 'value', graphicalItemId: 'sunburst' }
}

// What it renders when it IS active is asserted through the chart above, which
// is the same assertion plus the wiring. What only a direct render can reach is
// the guard: recharts mounts this content while nothing is hovered.
describe('SunburstTooltip', () => {
  it('renders nothing when it is not active or has no payload', () => {
    const { container: idle } = render(<SunburstTooltip payload={[entry('LA', 10)]} />)
    const { container: empty } = render(<SunburstTooltip active payload={[]} />)

    expect(idle).toBeEmptyDOMElement()
    expect(empty).toBeEmptyDOMElement()
  })
})
