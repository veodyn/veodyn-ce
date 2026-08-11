import { expect, test } from '@playwright/test'
import {
  addHeatmapToDashboard,
  authorTallHeatmap,
  openExpandedWidgetDialog,
  openHeatmapPreviewDialog,
} from './heatmap-interaction-helpers'
import { EPSILON, measure, MIN_SCROLL, scrollTo } from './heatmap-sticky-helpers'

// The THIRD host, and the one my own report got wrong. It said sticky worked
// inside the renderer's scroller there so the feature was "not broken, just two
// scrollbars". That was the same mistake this whole round is about.
//
// DialogWrapper's body was `px-6 py-4 max-h-[70vh] overflow-y-auto` on a panel
// whose height is auto. A max-height leaves the height INDEFINITE, so the
// renderer's own host bound resolved to nothing and it fell back to its 70vh
// cap: by construction its content is then 70vh PLUS p-4, the x-axis title and
// the legend, inside a body whose visible content box is 70vh MINUS its own
// padding. The body overflowed by roughly 110px, and scrolling it carried the
// stuck header band clean out of view, exactly as the widget's own scroller
// did. A `max-height` host constrains height in the letter of "bound against
// the host" and not in the part percentages can use.
//
// The fix is an opt-in `fill` prop on DialogWrapper giving the panel a definite
// `h-[85vh]` and the body `flex-1 min-h-0`. Opt-in and not the default because
// a survey of all 17 DialogWrapper call sites found 13 render short content (a
// single name input, a one-line error) that a definite height would balloon
// into a tall empty box.

const DIALOG = '[role="dialog"]'

// Viewport HEIGHTS, plural, and this is the point of the parameterisation
// rather than a thoroughness gesture. A filled dialog is a fraction of the
// viewport (`h-[85vh]`), so every absolute floor inside it is a bound that
// holds at some viewport heights and not others. The first version of this
// spec ran only at Playwright's default 720, where the expanded dialog's
// vestigial `min-h-[500px]` cleared its available space by 19px, so the spec
// written to close the finding could not fail at the one configuration it ran
// and failed everywhere below it. 660 is roughly the inner height of a
// 1366x768 laptop, which is not an exotic machine.
const VIEWPORT_HEIGHTS = [600, 660, 720, 900]
const VIEWPORT_WIDTH = 1280

// The share of its host box the grid's scrollport has to actually occupy.
//
// This exists because both sweeps below shipped bounded only from ABOVE, which
// is the shape this phase has now produced ten times: `scrollerHeight <=
// host.height` cannot tell "took its height from the host" apart from "took a
// sliver of it". A renderer capped at some small absolute height satisfies
// every other assertion here at once, since it yields exactly one scroller, is
// comfortably under the host, and still reports it can scroll. Round 2 proved
// that same defect red in the dashboard widget at `scrollerHeight: 0`, and
// these are the two hosts whose only floor was just removed.
//
// 0.65, chosen from measurement rather than picked. The renderer spends its
// p-4, the x-axis title and the legend out of the host before the scrollport
// gets what is left, so the correct share across the swept heights measures
// 0.748 to 0.860 in both dialogs. Against a deliberately slivered renderer
// (GRID_VIEWPORT_BOUND forced to `max-h-[200px]`) it measures 0.284 to 0.631.
// 0.65 sits between the two bands with about 0.1 of margin on the green side
// and catches the sliver at EVERY swept height; the 0.5 this first shipped
// with let the sliver through at the two smallest, where the host is small
// enough that even 200px is a respectable fraction of it.
const MIN_HOST_SHARE = 0.65

test('inside the expanded widget dialog only the grid scrolls, at every viewport height', async ({ page }) => {
  await authorTallHeatmap(page)
  await addHeatmapToDashboard(page)
  await openExpandedWidgetDialog(page)

  // Every height is checked before anything is asserted, so a failure names all
  // the heights that broke rather than only the first, which is what makes the
  // "holds at 720, fails below" shape legible from one run.
  const seen: Record<number, unknown> = {}
  const broken: number[] = []
  for (const height of VIEWPORT_HEIGHTS) {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height })
    const geometry = await measure(page, DIALOG)
    const scrolling = geometry.verticalScrollers.filter((s) => s.scrolls).map((s) => s.label)
    // The dialog body: a scroll container wrapping the renderer. Its absence is
    // folded into `broken` rather than asserted here, so one bad height cannot
    // abort the sweep before the others are measured, which is the whole point
    // of collecting first.
    const host = geometry.verticalScrollers.find((s) => s.label !== 'renderer')
    const share = host ? geometry.scrollerHeight / host.height : 0
    seen[height] = { scrolling, scrollerHeight: geometry.scrollerHeight, host, share: Number(share.toFixed(3)) }
    // THE FINDING: with an indefinite dialog body both scrolled, and the outer
    // one carried the sticky band away. A floor left inside the dialog
    // re-creates that below the viewport height where the floor still fits.
    const oneScroller = scrolling.length === 1 && scrolling[0] === 'renderer'
    // Bounded from BOTH sides. See MIN_HOST_SHARE.
    const boundedByHost = host != null && geometry.scrollerHeight <= host.height
    if (!host || !oneScroller || !boundedByHost || share < MIN_HOST_SHARE || !geometry.scrollerCanScrollY) {
      broken.push(height)
    }
  }
  expect(broken, JSON.stringify(seen, null, 1)).toEqual([])
})

test('the visualization preview dialog never clips the renderer, at every viewport height', async ({ page }) => {
  // The SECOND dialog that opts into `fill`, and until now the one with no e2e
  // coverage at all. Its renderer sits two layers deep: dialog body -> preview
  // column -> preview pane. The column is `overflow-hidden`, so a floor on the
  // pane does not hand scrolling back the way the expanded dialog's does. It
  // CLIPS, silently, and the legend and the bottom of the grid simply become
  // unreachable with no scrollbar anywhere to say so.
  await openHeatmapPreviewDialog(page)

  const seen: Record<number, unknown> = {}
  const broken: number[] = []
  for (const height of VIEWPORT_HEIGHTS) {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height })
    const geometry = await page.evaluate(() => {
      const grid = document.querySelector('[role="dialog"] [role="grid"]') as HTMLElement
      const scroller = grid.parentElement as HTMLElement
      // Named by structure, not by walking for an overflow value. The walk this
      // used to do looked for the nearest `overflow: hidden` ancestor, which
      // ran all the way to <body> the moment the preview column became
      // overflow-auto, reporting a 1933px "clipper" and a meaningless share.
      // The renderer's root, its host pane and the column sit at fixed depths,
      // so name them.
      const renderRoot = scroller.closest('.flex.h-full') as HTMLElement
      const host = renderRoot?.parentElement as HTMLElement
      const column = host?.parentElement as HTMLElement
      const legend = renderRoot?.lastElementChild as HTMLElement
      const box = (el: HTMLElement | null): { top: number; bottom: number; height: number } | null => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }
      }
      return {
        column: column
          ? {
              cls: column.className.toString().slice(0, 40),
              overflowY: getComputedStyle(column).overflowY,
              overflows: column.scrollHeight > column.clientHeight + 1,
              top: Math.round(column.getBoundingClientRect().top),
              bottom: Math.round(column.getBoundingClientRect().bottom),
              height: Math.round(column.getBoundingClientRect().height),
            }
          : null,
        host: box(host),
        legend: box(legend),
        // The grid's own scrollport, which this sweep did not measure at all.
        // "Nothing is clipped" is equally true of a renderer squeezed to a
        // sliver, and of one that is not there.
        scrollerHeight: Math.round(scroller.getBoundingClientRect().height),
        scrollerCanScrollY: scroller.scrollHeight > scroller.clientHeight,
      }
    })
    const share = geometry.host && geometry.host.height > 0 ? geometry.scrollerHeight / geometry.host.height : 0
    seen[height] = { ...geometry, share: Number(share.toFixed(3)) }
    const legendInside =
      geometry.legend != null && geometry.column != null && geometry.legend.bottom <= geometry.column.bottom + 1
    if (
      geometry.column == null
      || geometry.host == null
      // The column must never CLIP. Important B was this exact defect at a
      // larger size, and `overflow-hidden` here would silently swallow the
      // renderer's residual floor again below roughly a 465px viewport.
      || geometry.column.overflowY === 'hidden'
      // Across the swept range nothing should need to overflow at all: the
      // heights are wired so the renderer fits. A floor coming back shows up
      // here first.
      || geometry.column.overflows
      || !legendInside
      // FIXTURE, the same guard its sibling carries: the grid has to genuinely
      // overflow its scrollport, or this sweep quietly stops testing anything
      // the day the mock fixture loses rows.
      || !geometry.scrollerCanScrollY
      // Bounded from BOTH sides. See MIN_HOST_SHARE.
      || share < MIN_HOST_SHARE
    ) {
      broken.push(height)
    }
  }
  expect(broken, JSON.stringify(seen, null, 1)).toEqual([])
})

test('inside the expanded widget dialog the column header holds the top edge while the cells scroll away', async ({
  page,
}) => {
  await authorTallHeatmap(page)
  await addHeatmapToDashboard(page)
  await openExpandedWidgetDialog(page)

  const before = await measure(page, DIALOG)
  const seenBefore = JSON.stringify(before)
  expect(before.scrollerCanScrollY, seenBefore).toBe(true)
  expect(before.scrollTop, seenBefore).toBe(0)
  expect(before.firstCell.top, seenBefore).toBeGreaterThanOrEqual(before.columnHeader.bottom - EPSILON)

  const scrolled = await scrollTo(page, 'scrollTop', DIALOG)
  const after = await measure(page, DIALOG)
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
