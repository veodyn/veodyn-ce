import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { FunnelRenderer, FunnelTooltip } from './funnel-renderer'

// recharts measures its host div in a mount effect and draws nothing until it
// sees a positive width and height, which jsdom never reports on its own.
//
// The legend needs its own answer, and that is the trap this per-element shape
// exists for: one rect for EVERY element makes recharts measure a legend as the
// full plot height and subtract the whole plot away, so nothing is drawn and
// every case fails, including the control. A funnel renders no legend today,
// but the failure looks like "the renderer is broken" rather than like a mock,
// so it is answered here rather than left for whoever adds one.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const height = this.classList.contains('recharts-legend-wrapper') ? 24 : 400
    return {
      width: 800, height, top: 0, left: 0, bottom: height, right: 800, x: 0, y: 0,
      toJSON() { return this },
    } as DOMRect
  })
})

afterEach(() => vi.restoreAllMocks())

// Four columns and two candidate pairs, so a case that names its columns is
// telling a different story from a case that takes the fallbacks: the first two
// columns are stage/users, and phase/signups can only be reached through the
// options. The rows are deliberately out of order in both, so a renderer that
// forgot to sort would fail the order cases rather than pass them by accident.
const data: QueryResultData = {
  columns: [
    { name: 'stage', friendly_name: 'Stage', type: 'string' },
    { name: 'users', friendly_name: 'Users', type: 'integer' },
    { name: 'phase', friendly_name: 'Phase', type: 'string' },
    { name: 'signups', friendly_name: 'Signups', type: 'integer' },
  ],
  rows: [
    { stage: 'Trials', users: 400, phase: 'Interest', signups: 120 },
    { stage: 'Visitors', users: 800, phase: 'Awareness', signups: 300 },
    { stage: 'Buyers', users: 100, phase: 'Decision', signups: 60 },
  ],
}

function renderFunnel(options: Record<string, unknown>, rows: QueryResultData = data) {
  const visualization: MockVisualization = {
    id: 1, type: 'FUNNEL', name: 'Funnel', description: '',
    options, created_at: '', updated_at: '',
  }
  return render(<FunnelRenderer visualization={visualization} data={rows} />)
}

// The three label columns, told apart by the layout that distinguishes them on
// screen: names are right-aligned into the left gutter, the value and its share
// are left-aligned into the right one, and only the value is drawn in
// foreground ink. Each column is one LabelList, so its labels are siblings in
// data order, which is the sorted order the funnel reads in top to bottom.
//
// Keyed on the `fill` attribute rather than a fill-* class: recharts' Text
// writes its own hardcoded grey into that attribute, so the renderer has to set
// it explicitly, and a class beside it would be a second colour mechanism that
// says nothing about what actually lands in the DOM.
const namesOf = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('text[text-anchor="end"]')).map((t) => t.textContent)
const valuesOf = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('text[fill="var(--foreground)"]')).map((t) => t.textContent)
const sharesOf = (c: HTMLElement) =>
  Array.from(
    c.querySelectorAll('text[text-anchor="start"][fill="var(--muted-foreground)"]')
  ).map((t) => t.textContent)

describe('FunnelRenderer draws the steps', () => {
  it('draws one trapezoid per row', () => {
    const { container } = renderFunnel({})

    // The mark itself, not just the labels: recharts' draw-in animation never
    // completes under React 19, and a series that has not opted out paints an
    // empty plot.
    expect(container.querySelectorAll('.recharts-trapezoid')).toHaveLength(3)
  })

  it('keeps the step name, the raw value and the share of the first step', () => {
    const { container } = renderFunnel({})

    expect(namesOf(container)).toEqual(['Visitors', 'Trials', 'Buyers'])
    expect(valuesOf(container)).toEqual(['800', '400', '100'])
    expect(sharesOf(container)).toEqual(['100.0%', '50.0%', '12.5%'])
  })

  it('colours each step from the chart palette rather than a literal', () => {
    const { container } = renderFunnel({})

    const fills = Array.from(container.querySelectorAll('.recharts-trapezoid')).map((p) => p.getAttribute('fill'))
    expect(fills).toEqual(['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'])
    // recharts' own Funnel defaults are a grey fill and a white stroke, neither
    // of which any stylesheet reaches and neither of which the viz-chrome guard
    // can see, because the literals live in recharts and not in the renderer.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i)
  })
})

describe('FunnelRenderer option contract', () => {
  it('reads stepColumn and valueColumn from the saved options', () => {
    const { container } = renderFunnel({ stepColumn: 'phase', valueColumn: 'signups' })

    expect(namesOf(container)).toEqual(['Awareness', 'Interest', 'Decision'])
    expect(valuesOf(container)).toEqual(['300', '120', '60'])
  })

  it('falls back to the first column for the step and the second for the value', () => {
    const { container } = renderFunnel({})

    expect(namesOf(container)).toEqual(['Visitors', 'Trials', 'Buyers'])
    expect(valuesOf(container)).toEqual(['800', '400', '100'])
  })

  it('falls back per option, so naming only one still uses the other default', () => {
    const { container } = renderFunnel({ valueColumn: 'signups' })

    expect(namesOf(container)).toEqual(['Visitors', 'Trials', 'Buyers'])
    expect(valuesOf(container)).toEqual(['300', '120', '60'])
  })

  it('sorts by descending value when no sortOrder is saved', () => {
    const { container } = renderFunnel({})

    expect(namesOf(container)).toEqual(['Visitors', 'Trials', 'Buyers'])
  })

  it('sorts by ascending value when the options say so', () => {
    const { container } = renderFunnel({ sortOrder: 'asc' })

    expect(namesOf(container)).toEqual(['Buyers', 'Trials', 'Visitors'])
  })

  it('measures the share against the FIRST step, which ascending makes the smallest', () => {
    const { container } = renderFunnel({ sortOrder: 'asc' })

    // Not a percentage of the maximum: the first step is 100 here, so the rest
    // read over 100%. That is what the div stack showed, and the trapezoid
    // widths are against the maximum either way.
    expect(sharesOf(container)).toEqual(['100.0%', '400.0%', '800.0%'])
  })
})

describe('FunnelRenderer empty state', () => {
  it('asks for columns when the result has no second column to fall back to', () => {
    const oneColumn: QueryResultData = {
      columns: [{ name: 'stage', friendly_name: 'Stage', type: 'string' }],
      rows: [{ stage: 'Visitors' }],
    }

    renderFunnel({}, oneColumn)

    expect(screen.getByText('Configure step and value columns to display funnel.')).toBeInTheDocument()
  })

  it('asks for columns when the result has no rows', () => {
    renderFunnel({}, { columns: data.columns, rows: [] })

    expect(screen.getByText('Configure step and value columns to display funnel.')).toBeInTheDocument()
  })
})

const trapezoidsOf = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-trapezoid'))

// A step's two horizontal edges, read back off the path recharts draws.
// getTrapezoidPath emits five points (top left, top right, bottom right, bottom
// left, then back to the start), so the widths that give a funnel its shape are
// differences between x coordinates rather than attributes on the node.
function edgesOf(path: Element | undefined) {
  const points = (path?.getAttribute('d') ?? '').match(/-?[\d.]+,-?[\d.]+/g) ?? []
  const xs = points.map((point) => Number(point.split(',')[0]))
  return { top: xs[1] - xs[0], bottom: xs[2] - xs[3] }
}

function rowsOf(pairs: [string, number][]): QueryResultData {
  return { columns: data.columns, rows: pairs.map(([stage, users]) => ({ stage, users })) }
}

describe('FunnelRenderer draws the last step at its own value', () => {
  it('squares off the final step instead of tapering it to a point', () => {
    const { container } = renderFunnel({})

    // recharts' lastShapeType defaults to 'triangle', which closes the funnel
    // at zero width: it draws a stage after the last row that the data does not
    // have, reading as "everyone dropped off after Buyers".
    const last = edgesOf(trapezoidsOf(container)[2])
    expect(last.bottom).toBe(last.top)
    expect(last.bottom).toBeGreaterThan(2)
  })

  it('draws a one-step funnel as a full-width bar, the way the div stack did', () => {
    const { container } = renderFunnel({}, rowsOf([['Visitors', 800]]))

    const only = edgesOf(trapezoidsOf(container)[0])
    expect(trapezoidsOf(container)).toHaveLength(1)
    expect(only.bottom).toBe(only.top)
  })
})

describe('FunnelRenderer zero values', () => {
  it('draws a zero step as a hairline rather than dropping it', () => {
    const { container } = renderFunnel({}, rowsOf([['Visitors', 800], ['Trials', 400], ['Buyers', 0]]))

    // recharts' Trapezoid returns null when both its widths are zero, so the
    // step disappeared from a funnel that still printed its name and its 0
    // either side of the gap. The div stack pinned every bar to minWidth: 2px.
    expect(trapezoidsOf(container)).toHaveLength(3)
    const last = edgesOf(trapezoidsOf(container)[2])
    expect(last.top).toBe(2)
    expect(last.bottom).toBe(2)
    // A floor on the drawn width and not on the value: the gutter still says 0.
    expect(valuesOf(container)).toEqual(['800', '400', '0'])
  })

  it('says so when nothing is above zero, rather than painting an empty panel', () => {
    const { container } = renderFunnel({}, rowsOf([['Visitors', 0], ['Trials', 0], ['Buyers', 0]]))

    // Every width is scaled against the largest value, so an all-zero result
    // divides by zero and computes NaN geometry: recharts then draws nothing
    // and the panel reads as a failed render instead of as a result.
    expect(screen.getByText('No step has a value above zero, so there is no funnel to draw.')).toBeInTheDocument()
    expect(trapezoidsOf(container)).toHaveLength(0)
    // Not the configure message: the columns resolved and rows did come back.
    expect(screen.queryByText('Configure step and value columns to display funnel.')).not.toBeInTheDocument()
  })

  it('says the same for an all-negative result, which recharts would draw inside out', () => {
    // The largest value is the least negative one, so every other step divides
    // to more than 1 and the most negative step draws the widest.
    renderFunnel({}, rowsOf([['Visitors', -100], ['Trials', -400]]))

    expect(screen.getByText('No step has a value above zero, so there is no funnel to draw.')).toBeInTheDocument()
  })
})

// The shape recharts actually hands a Funnel tooltip: it passes the whole data
// row back as `payload`, which is where the two label strings already live.
function entry(step: Record<string, unknown>) {
  return { name: String(step.label), value: Number(step.value), payload: step, graphicalItemId: 'funnel' }
}

describe('FunnelTooltip', () => {
  // The wiring, not the panel: the four cases below render FunnelTooltip
  // directly, so removing `content={<FunnelTooltip />}` from the chart, or the
  // whole <Tooltip> with it, took the tooltip away from every user and left all
  // of them green. Hovering a step is what proves the chart reaches this panel.
  it('is what the chart opens when a step is hovered', () => {
    const { container } = renderFunnel({})

    const step = container.querySelector('.recharts-funnel-trapezoid')
    expect(step).not.toBeNull()
    if (step) fireEvent.mouseOver(step)

    const tooltip = container.querySelector('.recharts-tooltip-wrapper')
    expect(tooltip?.textContent).toBe('Visitors800 (100.0%)')
    // recharts' own default tooltip would also fill this wrapper, and it says
    // roughly the same words in an unthemed box, so the class is what tells the
    // two apart.
    expect(tooltip?.firstElementChild).toHaveClass('bg-card')
  })


  it('names the step and repeats its value and share, with no hardcoded colour', () => {
    const { container } = render(
      <FunnelTooltip
        active
        payload={[entry({ label: 'Trials', value: 400, valueLabel: '400', shareLabel: '50.0%' })]}
      />
    )

    expect(screen.getByText('Trials')).toBeInTheDocument()
    expect(screen.getByText(/400/)).toBeInTheDocument()
    expect(screen.getByText('(50.0%)')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('bg-card')
    expect(container.innerHTML).not.toMatch(/rgb\(|#[0-9a-f]{3,6}/i)
  })

  it('renders nothing when it is not active or has no payload', () => {
    const { container: idle } = render(
      <FunnelTooltip payload={[entry({ label: 'Trials', valueLabel: '400', shareLabel: '50.0%' })]} />
    )
    const { container: empty } = render(<FunnelTooltip active payload={[]} />)

    expect(idle).toBeEmptyDOMElement()
    expect(empty).toBeEmptyDOMElement()
  })
})
