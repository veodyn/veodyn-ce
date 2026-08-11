import { expect, test } from '@playwright/test'
import { addHeatmapToDashboard, authorTallHeatmap } from './heatmap-interaction-helpers'
import { EPSILON, measure, MIN_SCROLL, scrollTo } from './heatmap-sticky-helpers'
import { GRID_MIN_HEIGHT } from '../src/components/visualizations/heatmap-grid-chrome'

// Parsed from the component's own class rather than duplicated as a literal, so
// the floor and the assertions about it cannot drift apart. Throwing rather
// than defaulting to 0: a silent 0 would leave every lower-bound assertion
// below trivially true, which is the exact failure this parse exists to avoid.
const GRID_FLOOR_REM = GRID_MIN_HEIGHT.match(/\[([\d.]+)rem\]/)?.[1]
if (!GRID_FLOOR_REM) {
  throw new Error(`[heatmap-sticky] could not read a rem floor out of GRID_MIN_HEIGHT: ${GRID_MIN_HEIGHT}`)
}
const GRID_FLOOR_PX = parseFloat(GRID_FLOOR_REM) * 16

// The SECOND host. e2e/heatmap-sticky-headers.spec.ts asserts all of this in
// the query editor, which is the one surface that imposes no wrapper of its own
// (visualization-tabs.tsx says so in its own comment), so on its own it only
// ever proved the feature works where nothing could interfere with it.
//
// The dashboard widget is the counterexample, and it is not hypothetical.
// visualization-widget.tsx wraps the renderer in `flex-1 overflow-auto` inside
// a card whose height react-grid-layout sets in inline pixels: a widget added
// at the default 3x6 is 375px tall, far under any viewport-relative bound. With
// a bound expressed only as `max-h-[70vh]` there are two failures here, both
// measured before the fix:
//
//   1. A grid taller than the widget but shorter than 70vh never scrolls the
//      renderer's own wrapper at all. The WIDGET's overflow-auto scrolls
//      instead, and the column header slides away with the cells. That is the
//      original defect, unfixed, in the host where it is likelier than in the
//      query editor.
//   2. A grid taller than 70vh gives two nested vertical scrollbars, and
//      scrolling the outer one carries the stuck band off screen anyway.
//
// The fix is a second bound (`min-h-0 flex-1` under an `h-full` root) that
// takes its height from the HOST when the host has one. `height: 100%` against
// an indefinite ancestor computes to auto rather than erroring, so it does
// nothing in the query editor and everything here.

test('inside a dashboard widget the grid takes its bound from the widget, and exactly one element scrolls', async ({
  page,
}) => {
  await authorTallHeatmap(page)
  await addHeatmapToDashboard(page)

  const before = await measure(page)
  const seen = JSON.stringify(before)

  // FIXTURE, all about the host rather than the renderer: the widget really
  // does wrap the renderer in a scroll container of its own, and that container
  // is far shorter than the 70vh fallback would allow. Without both of these
  // this test is not about the case at issue.
  const host = before.verticalScrollers.find((s) => s.label !== 'renderer')
  expect(host, seen).toBeDefined()
  const viewportHeight = page.viewportSize()?.height ?? 0
  expect(viewportHeight, seen).toBeGreaterThan(0)
  expect(host?.height ?? 0, seen).toBeLessThan(0.7 * viewportHeight)

  // THE FINDING: exactly one element in the chain actually scrolls, and it is
  // the renderer's own scrollport. Under the viewport-only bound the renderer's
  // wrapper sized itself to 70vh (504px), overflowed the 328px widget body, and
  // both scrolled, which is the nested-scrollbar half of the defect. Reading
  // labels rather than a count so the failure message names which element.
  const scrolling = before.verticalScrollers.filter((s) => s.scrolls)
  expect(scrolling.map((s) => s.label), seen).toEqual(['renderer'])

  // And the other half: the renderer took its height FROM the widget rather
  // than from the viewport, which is what makes its own wrapper the element
  // that scrolls at all. A grid taller than the widget but shorter than 70vh
  // never scrolled the renderer's wrapper under the old bound, so the column
  // header slid away with the cells.
  expect(before.scrollerHeight, seen).toBeLessThanOrEqual(host?.height ?? 0)
  expect(before.scrollerCanScrollY, seen).toBe(true)
  // The other side of the bracket. Bounding the height only from ABOVE cannot
  // tell "took its height from the host" apart from "took almost no height at
  // all", which is a real reachable state (see the resize test below) and was
  // shipped once. A one-sided bound is the shape every could-not-fail test in
  // this phase had.
  //
  // Strictly greater than the floor, not "at least": at this widget size the
  // scroller measures about 250px, so an implementation that ignored the host
  // entirely and pinned the scroller AT the floor (a fixed `h-[8rem]`) would
  // satisfy a >= assertion while defeating the whole host bound.
  expect(before.scrollerHeight, seen).toBeGreaterThan(GRID_FLOOR_PX)
})

test('a widget dragged to its minimum height keeps the grid readable instead of collapsing it', async ({ page }) => {
  // `min-h-0` is what lets the scroller shrink to its host, and in a SMALL host
  // that is a trap: react-grid-layout's `minH: 2` at rowHeight 50 lets a user
  // drag a widget down to about 110px, and the renderer spends p-4, the x-axis
  // title and the legend out of that before flex-1 gets a say. Measured without
  // the floor, the scroller resolved to 28px against a 105px host: an invisible
  // strip where the grid should be, and strictly worse than the two-scrollbar
  // behaviour it replaced, because the content was not reachable at all.
  await authorTallHeatmap(page)
  await addHeatmapToDashboard(page)

  const card = page.locator('.react-grid-item').filter({ has: page.locator('[role="grid"]') })
  const handle = card.locator('.react-resizable-handle')
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  if (!box) return
  // A real drag on the real resize handle, which is the path a user takes.
  // react-grid-layout clamps to its own minH, so overshooting is safe.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y - 400, { steps: 12 })
  await page.mouse.up()
  // react-grid-layout re-enables its CSS transition on drag end, so the widget
  // is still animating for a frame or two after mouse.up. Poll the HOST's
  // height, which is the value actually in motion: the scroller's own height is
  // pinned at the floor from the first frame, so polling THAT settles nothing
  // and merely looks like it does.
  await expect
    .poll(async () => {
      const g = await measure(page)
      return g.verticalScrollers.find((s) => s.label !== 'renderer')?.height ?? Infinity
    })
    .toBeLessThan(GRID_FLOOR_PX)

  const after = await measure(page)
  const seen = JSON.stringify(after)

  // FIXTURE: the drag really did make the host too small to hold the floor, or
  // this test is just the previous one again.
  const host = after.verticalScrollers.find((s) => s.label !== 'renderer')
  expect(host, seen).toBeDefined()
  expect(host?.height ?? Infinity, seen).toBeLessThan(GRID_FLOOR_PX)

  // The grid keeps a usable height rather than collapsing to a strip...
  expect(after.scrollerHeight, seen).toBeGreaterThanOrEqual(GRID_FLOOR_PX)
  // ...and because it now refuses to shrink further, the renderer no longer
  // fits its host, so the HOST's own overflow takes over and the content stays
  // reachable. A short host degrades to the two-scroller behaviour that
  // predates this work, not to no content at all.
  expect(host?.scrolls, seen).toBe(true)

  // "Reachable" asserted rather than inferred. `scrolls` only says the host has
  // overflow to give; an ancestor clipping that overflow, or a host that
  // scrolls something other than the grid, satisfies it while the floored grid
  // stays just as invisible. So scroll the host for real and check the grid
  // moved into its visible box.
  const revealed = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    const scroller = grid.parentElement as HTMLElement
    // Filtered by computed overflow, exactly as measure() defines a scroller.
    // `scrollHeight > clientHeight` alone also matches an `overflow: visible`
    // ancestor, whose scrollTop is not writable, which silently found the wrong
    // element and reported no movement.
    const isScroller = (el: HTMLElement) => {
      const oy = getComputedStyle(el).overflowY
      return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight
    }
    let hostEl: HTMLElement | null = scroller.parentElement
    while (hostEl && !isScroller(hostEl)) hostEl = hostEl.parentElement
    if (!hostEl) return null
    const beforeTop = scroller.getBoundingClientRect().top
    hostEl.scrollTop = hostEl.scrollHeight
    const rect = scroller.getBoundingClientRect()
    const hostRect = hostEl.getBoundingClientRect()
    return {
      movedBy: Math.round(beforeTop - rect.top),
      scrollTop: hostEl.scrollTop,
      visibleGridHeight: Math.round(Math.min(rect.bottom, hostRect.bottom) - Math.max(rect.top, hostRect.top)),
    }
  })
  expect(revealed, seen).not.toBeNull()
  // Scrolling the host actually moved the grid, and left some of it on screen.
  expect(revealed?.movedBy ?? 0, JSON.stringify(revealed)).toBeGreaterThan(0)
  expect(revealed?.visibleGridHeight ?? 0, JSON.stringify(revealed)).toBeGreaterThan(0)
})

test('inside a dashboard widget the column header still holds the top edge while the cells scroll away', async ({
  page,
}) => {
  // The same measured relationship the query-editor spec asserts, in the host
  // that wraps the renderer. Re-asserted rather than assumed to carry over:
  // which element is the scrollport is exactly what differs between the two
  // hosts, and the scrollport is what sticky is offset against.
  await authorTallHeatmap(page)
  await addHeatmapToDashboard(page)

  const before = await measure(page)
  const seenBefore = JSON.stringify(before)
  expect(before.scrollerCanScrollY, seenBefore).toBe(true)
  expect(before.scrollTop, seenBefore).toBe(0)
  expect(before.firstCell.top, seenBefore).toBeGreaterThanOrEqual(before.columnHeader.bottom - EPSILON)

  const scrolled = await scrollTo(page, 'scrollTop')
  const after = await measure(page)
  const seen = JSON.stringify({ before, after, scrolled })

  expect(scrolled, seen).toBeGreaterThanOrEqual(MIN_SCROLL)
  expect(before.firstCell.top - after.firstCell.top, seen).toBeGreaterThanOrEqual(scrolled - EPSILON)

  // The header did not move, and is still flush against the scroller's top.
  expect(Math.abs(after.columnHeader.top - before.columnHeader.top), seen).toBeLessThanOrEqual(EPSILON)
  expect(Math.abs(after.columnHeader.top - after.scroller.top), seen).toBeLessThanOrEqual(EPSILON)
  // The cell that started beneath it is now entirely above it.
  expect(after.firstCell.bottom, seen).toBeLessThan(after.columnHeader.top)
  // Painted over the cells sliding under it, and opaque.
  expect(after.columnHeaderOnTop, seen).toBe(true)
  expect(after.columnHeaderAlpha, seen).toBe(1)
  expect(after.cornerAlpha, seen).toBe(1)
})
