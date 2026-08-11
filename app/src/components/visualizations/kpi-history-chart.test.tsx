import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DEFAULT_DISPLAY_PATTERNS } from '@/lib/date-pattern'
import { formatDateTime } from '@/lib/format-datetime'
import { renderWithProviders } from '@/test/utils'
import { KpiHistoryChart, HistoryTooltip } from './kpi-history-chart'
import type { HistoryReading } from './kpi-history-summary'

// The chart itself reads Settings > Formats (useFormats, and so useQuery), so it
// mounts through the providers; the tooltip is handed the formats directly,
// which is how a test can vary them.
const EUROPEAN_TWELVE_HOUR = { dateFormat: 'DD/MM/YYYY', timeFormat: 'hh:mm A' }

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 240,
    height: 64,
    top: 0,
    left: 0,
    bottom: 64,
    right: 240,
    x: 0,
    y: 0,
    toJSON() {
      return this
    },
  } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

// HistoryReading, not KpiHistoryPoint. The two differ by the `status` a stored
// point carries, and the chart never reads it: the bands come from the
// thresholds, not from per-point verdicts (kpi-history-summary.ts says so at
// the type). Typing the fixtures as the narrower thing the component actually
// takes is what lets this suite hold in a build with no KPI feature.
const FIRST: HistoryReading = { at: '2026-07-20T00:00:00Z', value: 72 }
const MIDDLE: HistoryReading = { at: '2026-07-21T00:00:00Z', value: 86 }
const LAST: HistoryReading = { at: '2026-07-22T00:00:00Z', value: 94 }

const history: HistoryReading[] = [FIRST, MIDDLE, LAST]

describe('KpiHistoryChart', () => {
  it('renders an SVG for non-empty history', () => {
    const { container } = renderWithProviders(<KpiHistoryChart history={history} />)

    expect(container.querySelector('[data-testid="kpi-history-chart"]')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('explains the empty state instead of rendering a blank box', () => {
    const { container } = renderWithProviders(<KpiHistoryChart history={[]} />)

    expect(screen.getByText(/No readings yet/i)).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  // A tooltip is hover-only, and hover is not available to everyone. The label
  // carries what a sighted reader takes from the shape, in the KPI's own unit,
  // rather than the bare "KPI history" that described the element and none of
  // its content.
  it('carries the readings in its accessible name, in the KPI unit', () => {
    renderWithProviders(<KpiHistoryChart history={history} unit="snapshots/hr" />)

    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('3 readings')
    expect(label).toContain('Started at 72 snapshots/hr')
    expect(label).toContain('ended at 94 snapshots/hr')
    expect(label).toContain('low 72 snapshots/hr')
    expect(label).toContain('high 94 snapshots/hr')
  })

  // Nothing sorts the readings, so the label must not describe them as a span
  // of time it has not checked. Ordered 22nd, 20th, 21st, the old wording read
  // "from 07/22 to 07/21": a range that runs backwards and that the line, drawn
  // in row order, never shows.
  it('does not announce a time range for readings drawn out of order', () => {
    renderWithProviders(<KpiHistoryChart history={[LAST, FIRST, MIDDLE]} unit="%" />)

    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).not.toMatch(/readings from .+ to /)
    expect(label).toContain('drawn in the order the query returned them rather than in time order')
    // The extremes are still true of the set however it is ordered, and the
    // endpoints are described as plotted rather than as started and ended.
    expect(label).toContain('First plotted 94%')
    expect(label).toContain('last plotted 86%')
    expect(label).toContain('low 72%')
  })

  // The control for the case above: in order, it says so, and the span is the
  // most useful thing it can say.
  it('announces the time range when the readings are in order', () => {
    renderWithProviders(<KpiHistoryChart history={history} unit="%" />)

    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/3 readings from .+ to .+\./)
  })

  it('says so plainly when there is only one reading', () => {
    renderWithProviders(<KpiHistoryChart history={[FIRST]} unit="%" />)

    // Percent hugs the digits, the same rule the value tile uses.
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('one reading, 72%')
  })

  // recharts only mounts tooltip content while a point is active, and jsdom
  // does no layout, so its pointer maths can never resolve one here. The
  // content component is what a hover renders, so it is exercised directly.
  // That a hover reaches it at all is covered in a browser, not in jsdom.
  it('gives the reading and its timestamp, in the KPI unit', () => {
    render(<HistoryTooltip active payload={[{ payload: MIDDLE }]} unit="snapshots/hr" patterns={DEFAULT_DISPLAY_PATTERNS} />)

    expect(screen.getByText('86 snapshots/hr')).toBeInTheDocument()
    // Through the shared formatter, in the reader's own timezone, rather than
    // the raw ISO string the point carries. Asserting a literal date here would
    // pin the suite to whatever offset the machine running it happens to be in.
    expect(screen.getByText(formatDateTime(MIDDLE.at, DEFAULT_DISPLAY_PATTERNS.dateFormat, DEFAULT_DISPLAY_PATTERNS.timeFormat))).toBeInTheDocument()
    expect(screen.queryByText(MIDDLE.at)).not.toBeInTheDocument()
  })

  it('writes that timestamp in the configured display format', () => {
    // The reason this chart takes the formats at all: a KPI reading was written
    // MM/DD/YY with a 24-hour clock whatever the operator had chosen.
    render(<HistoryTooltip active payload={[{ payload: MIDDLE }]} patterns={EUROPEAN_TWELVE_HOUR} />)

    // The form, not a literal instant: the reading is rendered in the reader's
    // own timezone, so the digits depend on where the suite runs. Day-first with
    // a four-digit year and a meridiem is what the setting asked for.
    expect(screen.getByText(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} (AM|PM)$/)).toBeInTheDocument()
  })

  it('renders nothing when no point is active', () => {
    const { container } = render(<HistoryTooltip payload={[{ payload: MIDDLE }]} patterns={DEFAULT_DISPLAY_PATTERNS} />)

    expect(container).toBeEmptyDOMElement()
  })
})
