import { expect, test } from '@playwright/test'
import {
  activeElementLabel,
  armScrollCounter,
  authorTallHeatmap,
  authorWideHeatmap,
  boxShadow,
  gridScroller,
  scrollCount,
  waitForScrollProcessed,
} from './heatmap-interaction-helpers'

// Task 5 fix round 4. Every earlier round tested the scroll behaviour against
// the 8-cell "Traffic Incidents" grid, which overflows nothing at all, by
// dispatching a synthetic `new Event('scroll')`. A synthetic event cannot
// exercise the thing dismissal is FOR (a cell sliding out from under a
// tooltip pinned to fixed viewport coordinates), and it cannot exercise the
// grid's own focus-driven scroll at all, so the case the code was fixed for
// had no coverage in either direction.
//
// These fixtures overflow for real, and the tests measure the overflow rather
// than assuming it: if a layout change ever stops either from scrolling, the
// fixture assertion fails loudly instead of leaving the rest of the test
// passing over nothing.
//
// Which axis overflows is a measured property of this page, not a choice.
// The renderer's own `p-4 overflow-auto` wrapper has no height constraint
// anywhere in its ancestor chain (measured: clientHeight === scrollHeight ===
// 4490 for a 30-row grid, with the DOCUMENT scrolling instead), so that
// wrapper is a real scroller on the horizontal axis only. The wide fixture
// therefore scrolls the wrapper, and the tall one scrolls the page, and
// between them both scroll paths the listener has to handle are covered.

// The three TOOLTIP tests below park the pointer outside the grid; the FOCUS
// RING test at the bottom deliberately does not. Chromium re-runs its hit
// test when content scrolls under a stationary pointer, so cells slide under
// the mouse and fire mouseover/mouseout with no pointer movement at all
// (measured: a 20-press ArrowDown walk with the mouse left where the
// authoring flow's last click put it produced an alternating over/out
// stream). The tooltip is genuinely owned by the pointer while the pointer is
// over the grid, by design, so a test asserting the KEYBOARD's tooltip has to
// take the pointer out of the picture to be about anything. The focus ring is
// not owned by the pointer and must survive that stream, which is a defect
// this round fixed rather than a test artifact, so its test runs with the
// pointer over the grid.
const POINTER_PARK = { x: 0, y: 0 }

// Deliberately far smaller than a cell. Any epsilon the anchor comparison
// uses has to sit well under the smallest scroll a user can mean, and a
// 200px scroll would pass just as happily against an epsilon of 199.
const SMALL_SCROLL = 12

test('a real scroll of the grid own overflow-auto wrapper closes the tooltip and keeps the focus ring', async ({
  page,
}) => {
  await authorWideHeatmap(page)
  await page.mouse.move(POINTER_PARK.x, POINTER_PARK.y)
  const scroller = gridScroller(page)

  const box = await scroller.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    overflowX: getComputedStyle(el).overflowX,
  }))
  expect(box.overflowX, JSON.stringify(box)).toBe('auto')
  expect(box.scrollWidth, JSON.stringify(box)).toBeGreaterThan(box.clientWidth + 200)
  // A scroll this small still has to dismiss: it moves the cell by 12px, far
  // past any sub-pixel tolerance the anchor comparison is entitled to.

  // Focus, not hover, drives the active cell here on purpose: a real scroll
  // moves the cell out from under a stationary pointer, so a hover-driven
  // active cell legitimately clears itself through mouseleave and could not
  // show whether the scroll listener spared the ring.
  const first = page.locator('[role="gridcell"]').first()
  const label = await first.getAttribute('aria-label')
  expect(label).not.toBeNull()
  await first.focus()
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveText(label as string)
  expect(await boxShadow(first)).not.toBe('none')

  await armScrollCounter(page)
  const since = await scrollCount(page)
  await scroller.evaluate((el, amount) => {
    el.scrollLeft = amount
  }, SMALL_SCROLL)
  await waitForScrollProcessed(page, since)

  // A scroll of a nested scroller does not bubble, so this event only reaches
  // a window listener subscribed with capture: true. That was round 3's own
  // finding, and it still holds here, now driven by a scroll that genuinely
  // happened rather than a hand-dispatched event.
  await expect(tooltip).toHaveCount(0)
  // The ring is a box-shadow on the cell's own box, so it travels with the
  // cell: clearing it would leave a focused cell with no visible focus
  // indicator at all, for a scroll that changed no focus.
  await expect(first).toBeFocused()
  expect(await boxShadow(first)).not.toBe('none')
})

test('a genuine scroll still closes the tooltip after an arrow press that scrolled nothing', async ({ page }) => {
  // The case a "suppress the next scroll event" flag gets wrong, and the
  // dominant case in practice: the arrow key moves focus to a cell that is
  // ALREADY visible, so the grid scrolls nothing and no scroll event ever
  // arrives to consume the suppression. The flag stays armed, and the user's
  // next real scroll is swallowed instead, leaving the tooltip pinned at a
  // viewport position its cell has left. Every fixture in this suite before
  // this round took this path on every arrow press, and nothing tested it.
  await authorWideHeatmap(page)
  await page.mouse.move(POINTER_PARK.x, POINTER_PARK.y)
  const scroller = gridScroller(page)
  const cells = page.locator('[role="gridcell"]')
  await cells.first().focus()
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveCount(1)

  await armScrollCounter(page)
  await page.keyboard.press('ArrowRight')
  const label = await activeElementLabel(page)
  expect(label).not.toBeNull()
  await expect(tooltip).toHaveText(label as string)

  // The half of this test that makes it a test of THIS path: the press has to
  // have scrolled nothing, or it is just the previous test again.
  expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(0)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await scrollCount(page)).toBe(0)

  const since = await scrollCount(page)
  await scroller.evaluate((el) => {
    el.scrollLeft = 200
  })
  await waitForScrollProcessed(page, since)

  await expect(tooltip).toHaveCount(0)
  const moved = page.getByLabel(label as string, { exact: true })
  await expect(moved).toBeFocused()
  expect(await boxShadow(moved)).not.toBe('none')
})

test('arrowing to an off-screen cell scrolls it into view, and the tooltip follows it there', async ({ page }) => {
  await authorTallHeatmap(page)
  await page.mouse.move(POINTER_PARK.x, POINTER_PARK.y)

  // Task 6 bounded the grid wrapper's height (that bound is what lets the
  // column headers stick at all; see e2e/heatmap-sticky-headers.spec.ts), so
  // this fixture now overflows the WRAPPER rather than the page: measured, the
  // document has 21px of scroll left and the wrapper has 3806. The path under
  // test is unchanged, since focusCellAt's scrollIntoView scrolls whichever
  // ancestor needs it, but which element to read the scroll off is not.
  const scroller = gridScroller(page)
  const box = await scroller.evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }))
  expect(box.scrollHeight, JSON.stringify(box)).toBeGreaterThan(box.clientHeight + 400)

  const cells = page.locator('[role="gridcell"]')
  await cells.first().focus()
  const tooltip = page.locator('[role="tooltip"]')
  await expect(tooltip).toHaveCount(1)
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(0)

  await armScrollCounter(page)
  const since = await scrollCount(page)
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('ArrowDown')
  }
  await waitForScrollProcessed(page, since)

  // A real scroll, caused by the grid's own navigation. focus() fires the
  // focus event BEFORE it scrolls (and its scroll event lands later still),
  // so an implementation that lets focus() scroll implicitly measures the
  // tooltip against the cell's pre-scroll position and then has that stale
  // tooltip dismissed by the scroll it caused itself. Taking the scroll back
  // (focus with preventScroll, then scrollIntoView, then re-measure) is what
  // makes the geometry below hold.
  const scrolled = await scroller.evaluate((el) => el.scrollTop)
  expect(scrolled).toBeGreaterThan(0)

  const label = await activeElementLabel(page)
  expect(label).not.toBeNull()
  await expect(tooltip).toHaveText(label as string)

  const geometry = await page.evaluate(() => {
    const cell = (document.activeElement as HTMLElement).getBoundingClientRect()
    const tip = (document.querySelector('[role="tooltip"]') as HTMLElement).getBoundingClientRect()
    return {
      cell: { top: cell.top, bottom: cell.bottom, left: cell.left, right: cell.right },
      tip: { top: tip.top, bottom: tip.bottom, left: tip.left, right: tip.right },
      innerHeight: window.innerHeight,
      innerWidth: window.innerWidth,
    }
  })
  const seen = JSON.stringify(geometry)

  // Scrolled into view: nearly all of the cell the keyboard landed on is on
  // screen. Not "entirely", because scrollIntoView({ block: 'nearest' })
  // aligns the cell's edge with the viewport's and the reflow that follows
  // the same keypress can leave a pixel or two of it hanging over; a couple
  // of pixels is not the defect this asserts against, which is a cell
  // hundreds of pixels below the fold.
  const cellHeight = geometry.cell.bottom - geometry.cell.top
  const onScreen = Math.min(geometry.cell.bottom, geometry.innerHeight) - Math.max(geometry.cell.top, 0)
  expect(onScreen / cellHeight, seen).toBeGreaterThan(0.9)

  // And the tooltip is against that cell's NEW position, above or below it,
  // not left behind at the position the cell held before the scroll (which
  // would be off by the whole scroll distance asserted above) and not closed.
  const gap = Math.min(
    Math.abs(geometry.cell.top - geometry.tip.bottom),
    Math.abs(geometry.tip.top - geometry.cell.bottom)
  )
  expect(gap, seen).toBeLessThanOrEqual(24)
  expect(geometry.tip.top, seen).toBeGreaterThanOrEqual(0)
  expect(geometry.tip.bottom, seen).toBeLessThanOrEqual(geometry.innerHeight)
  expect(geometry.tip.left, seen).toBeGreaterThanOrEqual(0)
  expect(geometry.tip.right, seen).toBeLessThanOrEqual(geometry.innerWidth)
})

test('a pointer resting over the grid never takes the focus ring off the focused cell', async ({ page }) => {
  // Runs with the pointer genuinely over the grid, which is the ordinary
  // configuration: a user reaches the Heatmap tab by clicking it, so the mouse
  // is already sitting over the visualization when they start using the
  // keyboard. Hover and focus share the state that drives the tooltip and the
  // row/column band, which is deliberate, but the FOCUS RING cannot be part of
  // that bargain: hovering another cell used to steal it, and the pointer
  // leaving a cell used to clear it outright, neither of which involves a
  // focus change. Scrolling alone produces both, with the mouse never moving.
  await authorWideHeatmap(page)
  const scroller = gridScroller(page)
  const cells = page.locator('[role="gridcell"]')

  // The wide fixture is 30 columns by 6 rows in row-major DOM order, so cell
  // 35 is column 5 of row 1: it shares neither its row nor its column with
  // cell 0, and the row/column band therefore cannot be what leaves a ring on
  // cell 0 below.
  const focused = cells.nth(0)
  const hovered = cells.nth(35)
  await focused.focus()
  await expect(focused).toBeFocused()
  await hovered.hover()

  await expect(focused).toBeFocused()
  expect(await boxShadow(focused)).not.toBe('none')

  // Now the pointer stays exactly where it is and the content moves under it,
  // which fires mouseleave on the hovered cell with no focus change at all.
  await armScrollCounter(page)
  const since = await scrollCount(page)
  await scroller.evaluate((el) => {
    el.scrollLeft = 200
  })
  await waitForScrollProcessed(page, since)

  await expect(focused).toBeFocused()
  expect(await boxShadow(focused)).not.toBe('none')
})
