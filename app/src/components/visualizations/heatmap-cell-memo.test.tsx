import { createElement, memo } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import type { HeatmapCellProps } from './heatmap-cell'
import { HeatmapRenderer } from './heatmap-renderer'

// Task 5 fix round 4. Round 1 (important finding 4) made hovering a cell cost
// only the cells whose own state changed, by memoizing the colour factories
// and HeatmapCell itself and keeping every prop that crosses that boundary
// value- or reference-stable. The only test pinning any of that was a spy
// counting getSequentialScale/getSequentialInk CALLS, deleted in round 3
// because a call count is not the requirement: it asserted a non-requirement
// for getSequentialScale, and for getSequentialInk it would have blocked a
// strictly better future implementation that resolves its tokens lazily
// inside the returned closure (which is cheap to call on every render).
//
// What IS observable, and what the finding was actually about, is how much of
// the grid re-renders per pointer transition. That is what this file counts.
// A lazy-ink refactor changes the call count and leaves these counts exactly
// as they are, so it stays unblocked.

// vi.hoisted, not a plain const: the vi.mock factory below is hoisted above
// this file's own body, so a body-level binding would still be in its
// temporal dead zone by the time the factory runs.
const { renders } = vi.hoisted(() => ({ renders: [] as string[] }))

vi.mock('./heatmap-cell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./heatmap-cell')>()
  // memo()'d with React's own default shallow comparison, the same thing the
  // real component is wrapped in, so this stand-in re-renders exactly when
  // the real one does and the counts below measure the real prop stability
  // rather than this file's own wrapper. It cannot, by construction, notice
  // memo() being dropped from the real component (its own memo would still
  // skip), which is why that is asserted separately, against the unmocked
  // module, in the first test below.
  const Counting = memo(function HeatmapCell(props: HeatmapCellProps) {
    renders.push(`${props.x} ${props.y}`)
    return createElement(actual.HeatmapCell, props)
  })
  return { ...actual, HeatmapCell: Counting }
})

const visualization: MockVisualization = {
  id: 1,
  type: 'HEATMAP',
  name: 'Test heatmap',
  description: '',
  options: { columnMapping: { weekday: 'x', period: 'y', count: 'value' } },
  created_at: '2026-07-21T00:00:00Z',
  updated_at: '2026-07-21T00:00:00Z',
}

// 3x3, fully populated, so every cell has a real colour and ink string and
// the row/column band around the hovered cell is a strict subset of the grid.
const X = ['Monday', 'Tuesday', 'Wednesday']
const Y = ['Morning', 'Midday', 'Evening']
const data: QueryResultData = {
  columns: [
    { name: 'weekday', friendly_name: 'Weekday', type: 'string' },
    { name: 'period', friendly_name: 'Period', type: 'string' },
    { name: 'count', friendly_name: 'Count', type: 'integer' },
  ],
  rows: X.flatMap((weekday, xi) => Y.map((period, yi) => ({ weekday, period, count: 10 + xi * 3 + yi }))),
}

// Counts, not a Set of distinct keys. A Set hides repetition, so an
// implementation that rendered each affected cell three times per pointer
// transition (batching broken between the two setStates behind one hover), or
// mounted the grid twice, would read identically to a correct one.
function renderCounts(): Record<string, number> {
  return renders.reduce<Record<string, number>>((acc, key) => {
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

describe('HeatmapCell re-render cost per pointer transition', () => {
  beforeEach(() => {
    renders.length = 0
  })

  it('exports a memoized component, so a stable prop set can skip a render at all', async () => {
    // A structural assertion, which is weaker than a behavioural one and is
    // here only because the counting wrapper below makes a behavioural one
    // impossible (the wrapper's own memo would skip the render either way).
    // It passes under memo(C, () => true), which is memoized and broken, and
    // it fails under a legitimate forwardRef(memo(C)) reordering. The counts
    // in the other tests are what actually pin the behaviour.
    const actual = await vi.importActual<typeof import('./heatmap-cell')>('./heatmap-cell')
    expect(actual.HeatmapCell.$$typeof).toBe(Symbol.for('react.memo'))
  })

  it('re-renders only the hovered cell row and column, not the whole grid', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)
    // Every cell once, and only once: a double mount would show up here.
    expect(Object.values(renderCounts())).toEqual(Array(9).fill(1))

    renders.length = 0
    await user.hover(screen.getByLabelText('Monday / Morning: 10'))

    // Hovering Monday/Morning changes isRowActive for the whole Morning row,
    // isColActive for the whole Monday column, and isActiveCell for the one
    // cell in both. Every other cell's props are byte-identical to what they
    // already had, so a re-render of one is wasted work: the colour factories
    // being recomputed per render, or any handler losing its stable identity,
    // shows up here as the whole 9-cell grid re-rendering instead of 5.
    expect(renderCounts()).toEqual({
      'Monday Morning': 1,
      'Tuesday Morning': 1,
      'Wednesday Morning': 1,
      'Monday Midday': 1,
      'Monday Evening': 1,
    })
  })

  it('re-renders only the two affected bands when the pointer moves to an unrelated cell', async () => {
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)
    await user.hover(screen.getByLabelText('Monday / Morning: 10'))

    renders.length = 0
    await user.hover(screen.getByLabelText('Wednesday / Evening: 18'))

    // Leaving Monday/Morning and entering Wednesday/Evening touches both
    // crosses and nothing else: Wednesday/Midday and Tuesday/Evening, which
    // are in neither cross, keep the props they already had.
    // Two commits, one per pointer event: the mouseleave takes the active
    // state off Monday/Morning's cross, the mouseenter puts it on
    // Wednesday/Evening's. The two cells in both crosses render once for each.
    expect(renderCounts()).toEqual({
      'Monday Morning': 1,
      'Tuesday Morning': 1,
      'Wednesday Morning': 2,
      'Monday Midday': 1,
      'Monday Evening': 2,
      'Wednesday Midday': 1,
      'Tuesday Evening': 1,
      'Wednesday Evening': 1,
    })
  })

  it('re-renders only the two affected bands when KEYBOARD focus moves, not the whole grid', async () => {
    // The pointer-only tests above cannot see this. They never focus a cell,
    // so focusedCell is null throughout them, and a handler that took
    // focusedCell as a useCallback dependency would keep its identity across
    // every one of their transitions and pass them untouched. Moving focus is
    // what changes focusedCell, and a handler rebuilt on that change is a new
    // prop on all nine cells, which is why the grid's hover-departure fix
    // reads the focused cell out of a ref instead.
    const user = userEvent.setup()
    render(<HeatmapRenderer visualization={visualization} data={data} />)
    await user.tab()
    expect(screen.getByLabelText('Monday / Morning: 10')).toHaveFocus()

    renders.length = 0
    await user.keyboard('{ArrowRight}')
    expect(screen.getByLabelText('Tuesday / Morning: 13')).toHaveFocus()

    // Monday's cross and Tuesday's cross between them are seven of the nine
    // cells. These two are in neither, so nothing about their props changed
    // and a render of either is the whole grid re-rendering behind a handler
    // that lost its identity.
    const counts = renderCounts()
    expect(counts['Wednesday Midday']).toBeUndefined()
    expect(counts['Wednesday Evening']).toBeUndefined()
  })
})
