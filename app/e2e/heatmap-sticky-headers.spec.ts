import { expect, test } from '@playwright/test'
import { authorHeatmap, authorTallHeatmap, authorWideHeatmap, gridScroller } from './heatmap-interaction-helpers'
import { EPSILON, measure, MIN_SCROLL, scrollTo } from './heatmap-sticky-helpers'
import { ROW_HEADER_MIN_WIDTH } from '../src/components/visualizations/heatmap-grid-chrome'

// The floor in px, derived from the component's own constant rather than
// duplicated as a literal, so the two cannot drift apart.
const ROW_HEADER_FLOOR_PX = parseFloat(ROW_HEADER_MIN_WIDTH) * 16

// Task 6. Stickiness is layout, and jsdom implements none of it, so none of
// this can be asserted in a unit test. Asserting `position: sticky` shows up in
// the computed style would be worse than nothing: it proves a class is applied
// and says nothing about whether anything sticks, which is exactly what an
// ancestor with the wrong overflow silently breaks.
//
// Every assertion below is therefore a measured RELATIONSHIP that only holds
// when the header genuinely stays put: the header's own rect against the
// scroller's edge, compared with the rect of a cell that started right beside
// it. Both are read after the same scroll, so "the header did not move" is
// only meaningful because "the cell did" is asserted next to it.
//
// These tests all run in the QUERY EDITOR host, which imposes no wrapper of its
// own. e2e/heatmap-sticky-dashboard.spec.ts asserts the same relationships in
// the dashboard widget, which does.
//
// What made this task's brief wrong, measured rather than assumed. The grid's
// `overflow-auto` wrapper had no height constraint in any of the seven places
// this component renders, so it grew to content and the DOCUMENT scrolled
// instead. A sticky box is offset against its NEAREST scrollport and never
// consults an outer one, and that wrapper is a scroll container, so it IS the
// nearest scrollport; it simply never scrolled on that axis, and `sticky top-0`
// inside it moved off the top of the screen with the page exactly as far as the
// cells did. Measured directly in Chromium against a standalone probe of that
// same shape: with the page scrolled 400px, the column header and the first
// cell BOTH moved 400px. Bounding the wrapper's height is what makes a sticky
// column header mean anything, which is why the vertical test below asserts the
// wrapper is a real vertical scroller first: remove that bound and this spec
// goes red on the fixture, not on a subtle geometry check.

test('the row header column stays at the left edge while the cell beside it scrolls away', async ({ page }) => {
  // 30 date columns by 6 line rows: wide enough to overflow the wrapper
  // horizontally, short enough NOT to overflow it vertically, so this test is
  // about one axis only.
  await authorWideHeatmap(page)
  const before = await measure(page)
  const seenBefore = JSON.stringify(before)

  expect(before.overflowX, seenBefore).toBe('auto')
  expect(before.scrollerCanScrollX, seenBefore).toBe(true)
  expect(before.scrollLeft, seenBefore).toBe(0)
  // The premise of the whole test: the cell starts immediately beside the row
  // header, so "it moved away" below is a statement about the two of them.
  expect(before.firstCell.left, seenBefore).toBeGreaterThanOrEqual(before.rowHeader.right - EPSILON)
  expect(before.firstCell.left - before.rowHeader.right, seenBefore).toBeLessThan(8)

  const scrolled = await scrollTo(page, 'scrollLeft')
  const after = await measure(page)
  const seen = JSON.stringify({ before, after, scrolled })

  // The scroll actually happened, by enough to be worth measuring, and it
  // moved the cell by that whole amount.
  expect(scrolled, seen).toBeGreaterThanOrEqual(MIN_SCROLL)
  expect(before.firstCell.left - after.firstCell.left, seen).toBeGreaterThanOrEqual(scrolled - EPSILON)

  // ...and the row header did not move at all, and is still flush against the
  // scroller's own left edge rather than parked somewhere arbitrary.
  expect(Math.abs(after.rowHeader.left - before.rowHeader.left), seen).toBeLessThanOrEqual(EPSILON)
  expect(Math.abs(after.rowHeader.left - after.scroller.left), seen).toBeLessThanOrEqual(EPSILON)

  // The cell that started beside it is now entirely to its left, which is only
  // possible if the header stayed while the row moved.
  expect(after.firstCell.right, seen).toBeLessThan(after.rowHeader.left)

  // And the header is painted over the cells now sliding under it, not behind
  // them.
  expect(after.rowHeaderOnTop, seen).toBe(true)

  // And it still says what it says. This is the assertion that would have
  // caught the row-header track collapsing to 8px on a grid this wide (a
  // defect that predates this task): every geometric assertion above passes
  // just as happily against a header stuck in place with its label clipped
  // away entirely.
  expect(after.rowHeaderText, seen).not.toBe('')
  expect(after.rowHeaderClipped, seen).toBe(false)

  // And it is fully opaque. A resolved paint value, not a class check: a sticky
  // header with no background of its own computes to rgba(0, 0, 0, 0) and lets
  // the cells scrolling under it show straight through, which every other
  // assertion in this test passes over happily (elementFromPoint reports the
  // header whether or not it paints anything). Asserting alpha === 1 rather
  // than "not transparent", because a TRANSLUCENT background is the same defect
  // in weaker form and would pass an inequality check.
  expect(after.rowHeaderAlpha, seen).toBe(1)
  // The corner is stuck on both axes, so it has cells passing under it from two
  // directions and needs the background just as much.
  expect(after.cornerAlpha, seen).toBe(1)
})

test('the row header gutter holds its floor on a narrow grid, which costs a short label some width', async ({
  page,
}) => {
  // The cost of ROW_HEADER_MIN_WIDTH, pinned rather than left implied. The
  // floor exists because `truncate` zeroes the track's min-content
  // contribution, which collapsed the gutter to 8px on a wide grid. On a NARROW
  // grid, where the track is free to size to content, the floor still applies
  // and reserves more width than the label needs. That is a real trade, so it
  // is asserted as a fact here rather than described as "sizes to its longest
  // label", which is only true above the floor.
  await authorHeatmap(page)
  const before = await measure(page)
  const seen = JSON.stringify(before)

  // Fixture: this grid is NOT over-constrained, so the track could size to
  // content if the floor let it.
  expect(before.scrollerCanScrollX, seen).toBe(false)

  // What the label actually needs, measured off a clone carrying the real font
  // and padding rather than a guess at them.
  const intrinsic = await page.locator('[role="rowheader"]').first().evaluate((el) => {
    const probe = el.cloneNode(true) as HTMLElement
    probe.style.position = 'fixed'
    probe.style.left = '-9999px'
    probe.style.width = 'auto'
    probe.style.overflow = 'visible'
    document.body.appendChild(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  })

  expect(before.rowHeaderClipped, seen).toBe(false)
  expect(before.rowHeaderWidth, JSON.stringify({ seen, intrinsic })).toBeCloseTo(ROW_HEADER_FLOOR_PX, 1)
  // The trade, stated as an assertion: the gutter is wider than this label
  // needs. If a future change ever makes the track size to content below the
  // floor, this is the test that should be revisited, not silently left green.
  expect(intrinsic, JSON.stringify({ seen, intrinsic })).toBeLessThan(ROW_HEADER_FLOOR_PX)
})

test('the row header gutter grows past its floor for a label that needs more', async ({ page }) => {
  // The other half of `minmax(4rem, auto)`, and the half nothing pinned before:
  // every assertion in the test above passes just as well against a FIXED track
  // (`minmax(4rem, 4rem)`, or `width: 4rem`), which would silently truncate
  // every label wider than the floor. This fixture's y labels are dates
  // (measured 70.41px against a 56px content box), so the track has to grow.
  await authorTallHeatmap(page)
  const before = await measure(page)
  const seen = JSON.stringify(before)

  expect(before.rowHeaderWidth, seen).toBeGreaterThan(ROW_HEADER_FLOOR_PX)
  // And having grown, it shows the whole label rather than growing part way.
  expect(before.rowHeaderClipped, seen).toBe(false)
  expect(before.rowHeaderText, seen).not.toBe('')
})

test('the column header row stays at the top edge while the cell beneath it scrolls away', async ({ page }) => {
  // 6 line columns by 30 date rows. This is the fixture that used to scroll
  // the PAGE rather than the wrapper; the wrapper's bounded height is what
  // makes it scroll here, and scrollerCanScrollY below is the assertion that
  // goes red first if that bound is ever removed.
  await authorTallHeatmap(page)
  const before = await measure(page)
  const seenBefore = JSON.stringify(before)

  expect(before.overflowY, seenBefore).toBe('auto')
  expect(before.scrollerCanScrollY, seenBefore).toBe(true)
  expect(before.scrollTop, seenBefore).toBe(0)
  expect(before.firstCell.top, seenBefore).toBeGreaterThanOrEqual(before.columnHeader.bottom - EPSILON)
  expect(before.firstCell.top - before.columnHeader.bottom, seenBefore).toBeLessThan(8)

  const scrolled = await scrollTo(page, 'scrollTop')
  const after = await measure(page)
  const seen = JSON.stringify({ before, after, scrolled })

  expect(scrolled, seen).toBeGreaterThanOrEqual(MIN_SCROLL)
  expect(before.firstCell.top - after.firstCell.top, seen).toBeGreaterThanOrEqual(scrolled - EPSILON)

  expect(Math.abs(after.columnHeader.top - before.columnHeader.top), seen).toBeLessThanOrEqual(EPSILON)
  expect(Math.abs(after.columnHeader.top - after.scroller.top), seen).toBeLessThanOrEqual(EPSILON)
  expect(after.firstCell.bottom, seen).toBeLessThan(after.columnHeader.top)
  expect(after.columnHeaderOnTop, seen).toBe(true)
  expect(after.columnHeaderAlpha, seen).toBe(1)
  expect(after.cornerAlpha, seen).toBe(1)
})

test('the corner cell holds both edges at once when the grid scrolls diagonally', async ({ page }) => {
  // The corner is the only element stuck on two axes, and therefore the only
  // one that can end up UNDER another header: it shares its column with every
  // row header and its row with every column header, so a stacking order that
  // put either band above it would hide it the moment both axes scroll.
  await authorWideHeatmap(page)
  const scroller = gridScroller(page)

  // The wide fixture is deliberately short (that is what makes the first test
  // single-axis), so this one shrinks the scroller by hand to give it a second
  // axis. The override is on max-height, the same property the component sets,
  // so what is being exercised is still the component's own sticky rules.
  await scroller.evaluate((el) => {
    el.style.maxHeight = '160px'
  })

  const before = await measure(page)
  expect(before.scrollerCanScrollX, JSON.stringify(before)).toBe(true)
  expect(before.scrollerCanScrollY, JSON.stringify(before)).toBe(true)

  const scrolledX = await scrollTo(page, 'scrollLeft')
  const scrolledY = await scrollTo(page, 'scrollTop')
  const after = await measure(page)
  const seen = JSON.stringify({ before, after, scrolledX, scrolledY })

  expect(scrolledX, seen).toBeGreaterThanOrEqual(MIN_SCROLL)
  expect(scrolledY, seen).toBeGreaterThan(0)
  expect(Math.abs(after.corner.left - after.scroller.left), seen).toBeLessThanOrEqual(EPSILON)
  expect(Math.abs(after.corner.top - after.scroller.top), seen).toBeLessThanOrEqual(EPSILON)
  // Both other bands moved on the axis the corner held for them.
  expect(before.firstCell.left - after.firstCell.left, seen).toBeGreaterThanOrEqual(scrolledX - EPSILON)
  expect(before.firstCell.top - after.firstCell.top, seen).toBeGreaterThanOrEqual(scrolledY - EPSILON)

  const cornerOnTop = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    const corner = grid.querySelectorAll<HTMLElement>('[role="columnheader"]')[0]
    const r = corner.getBoundingClientRect()
    const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
    return at != null && (at === corner || corner.contains(at))
  })
  expect(cornerOnTop, seen).toBe(true)
})
