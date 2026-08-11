import { expect, type Locator, type Page } from '@playwright/test'
import { authorHeatmapOnQuery, configureHeatmapDialog } from './heatmap-authoring'

// Shared fixtures and helpers for e2e/heatmap-interaction.spec.ts, split out
// once that file grew a second and third test() (round 2's theme-repaint and
// scroll-dismiss cases) past the file-size hook's limit. Everything here is
// setup/plumbing, not assertions: the tests themselves stay in the spec file.
//
// The dialog-driving half lives in ./heatmap-authoring.ts, split out when this
// file hit the same limit again. It imports nothing from here, so the two do
// not form a cycle.

export async function boxShadow(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).boxShadow)
}

// A heatmap cell's own aria-label, computed off the SAME regexp the roving-
// tabIndex reachability check in the spec uses to recognize "landed on a
// grid cell": the value half can be an integer, "no data", or a bounded
// decimal (an 'avg' aggregation's value), and can carry a leading minus sign
// (a 'min'/'max'/'sum' aggregation over negative source values, or an 'avg'
// that lands negative). Not reachable by the spec's own fixture (every sum
// there is positive), but the Tab-walk loop silently reports "not on a grid
// cell" for a real negative value if this regexp does not admit one.
export const CELL_LABEL_RE = /: (-?\d+(\.\d+)?|no data)$/

export async function activeElementLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
}

// The renderer's own scrolling wrapper, the element a scroll of the grid itself
// happens on, and the scrollport both sticky header bands are offset against.
// It is the grid's direct parent; the renderer's `p-4` sits further out, on the
// root, so that a header stuck at left-0/top-0 lands flush against the visible
// edge rather than a padding width inside it. Named here so the specs do not
// each re-derive it.
export function gridScroller(page: Page, scope = 'body'): Locator {
  return page.locator(scope).locator('[role="grid"]').locator('xpath=..')
}

interface ScrollProbeWindow extends Window {
  __heatmapScrolls: number
}

// Counts scroll events reaching window, so a test can wait for the scroll it
// caused to have actually been DELIVERED before asserting anything about what
// survived it. Without that barrier, "the tooltip is still open" is read
// immediately after a synchronous scrollTop write and passes on the first
// poll, before any dismissal could have landed: it would pass just as well
// against an implementation that closes the tooltip on every scroll.
export async function armScrollCounter(page: Page) {
  await page.evaluate(() => {
    const probe = window as unknown as ScrollProbeWindow
    probe.__heatmapScrolls = 0
    window.addEventListener('scroll', () => { probe.__heatmapScrolls += 1 }, true)
  })
}

export async function scrollCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as ScrollProbeWindow).__heatmapScrolls)
}

// `since` is the count captured immediately before the action under test, so
// this waits for a scroll event caused by THAT action. Polling for a count
// above zero instead would return on a scroll event from anything earlier in
// the test, which after a multi-press keyboard walk can be the very first one.
export async function waitForScrollProcessed(page: Page, since: number) {
  await expect.poll(() => scrollCount(page)).toBeGreaterThan(since)
  // Two animation frames past delivery, which is the barrier that actually
  // does the work here. Listener order gives nothing: this probe subscribes
  // before the grid's listener in a test that arms the counter first, and
  // after it in a test that focuses a cell first (the grid only subscribes
  // once a cell is active), so the counter can tick either side of the grid's
  // own handler. React also flushes the resulting state update asynchronously
  // regardless of which ran first.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  )
}

// query id 4 ("Traffic Incidents This Week") has category/severity/
// incident_count columns already in the mock pack, summed here by hand from
// src/lib/mock-data/packs/neutral/query-results.ts (id 104) against the
// default 'sum' aggregation, category -> x, severity -> y:
//   Accident/Major: 12+15+9 = 36        Road Work/Major: (none)
//   Closure/Major: 5+7 = 12             Hazard/Major: (none)
//   Accident/Minor: 34+41+37 = 112      Road Work/Minor: 28+31+25 = 84
//   Closure/Minor: (none)               Hazard/Minor: 18+22 = 40
// xCategories (column DOM order) is [Accident, Road Work, Closure, Hazard];
// yCategories (row DOM order) is [Major, Minor]. ACTIVE is therefore both
// the FIRST cell in the grid (the initial roving tabIndex=0 stop) and a
// first-ROW cell, the exact shape the tooltip-clipping defect needs.
export const ACTIVE = 'Accident / Major: 36'
export const NEXT_COLUMN = 'Road Work / Major: no data' // one ArrowRight from ACTIVE
export const NEXT_ROW = 'Road Work / Minor: 84' // one ArrowDown from NEXT_COLUMN
export const SAME_ROW = 'Closure / Major: 12' // shares severity (row) with ACTIVE
export const SAME_COL = 'Accident / Minor: 112' // shares category (column) with ACTIVE
export const UNRELATED = 'Road Work / Minor: 84' // shares neither with ACTIVE

// Authors the same Heatmap visualization against the existing "Traffic
// Incidents This Week" query through the app's own "New Visualization"
// dialog, landing on its own tab. Shared by every test in the spec file, so
// none of them duplicates the whole authoring flow.
export async function authorHeatmap(page: Page) {
  await authorHeatmapOnQuery(page, {
    queryId: 4,
    heading: 'Traffic Incidents This Week',
    x: 'category',
    y: 'severity',
    value: 'incident_count',
  })
}

// The scroll fixtures. Query 1 ("Rail Network Daily Ridership") carries 30
// dates across 6 rail lines, so the same rows make either a 30-column grid
// (wide: enough to overflow the renderer's own `p-4 overflow-auto` wrapper
// horizontally, which is the only axis on which that wrapper is a real
// scroller, since nothing on this page constrains its height) or a 30-row one
// (tall: 4430px of grid, which overflows the PAGE instead). Both are measured
// in the specs themselves rather than assumed, so a layout change that stops
// either from overflowing fails the test instead of quietly hollowing it out.
//
// Neither fixture's own VALUES are asserted anywhere: query 1's mock rows are
// generated with Math.random(), so the specs read each cell's accessible name
// off the DOM rather than hard-coding one.
export async function authorWideHeatmap(page: Page) {
  await authorHeatmapOnQuery(page, {
    queryId: 1,
    heading: 'Rail Network Daily Ridership',
    x: 'date',
    y: 'line',
    value: 'vehicle_count',
  })
}

// A fixture whose CATEGORY names are long. Query 8's hour column carries raw
// datetime strings, so a cell's description runs to "2026-03-18T00:00:00 /
// Clear: 71.2" rather than the eight or so characters every other fixture in
// this suite happens to produce. The tooltip's width bound is a property of
// the component, not of a short label, and only a label like this one can
// show that.
export async function authorLongLabelHeatmap(page: Page) {
  await authorHeatmapOnQuery(page, {
    queryId: 8,
    heading: 'Weather & Temperature History',
    x: 'hour',
    y: 'condition',
    value: 'temp_f',
  })
}

// The same long categories, over a grid tall enough that the PAGE scrolls
// (query 8's humidity column gives about 36 distinct y values against 48
// hours), so a test can put a specific cell at a specific viewport offset.
// The wide long-label fixture cannot: its single row sits 269px down the page
// and the page never scrolls far enough to lift it near the top.
export async function authorTallLongLabelHeatmap(page: Page) {
  await authorHeatmapOnQuery(page, {
    queryId: 8,
    heading: 'Weather & Temperature History',
    x: 'hour',
    y: 'humidity',
    value: 'temp_f',
  })
}

export async function authorTallHeatmap(page: Page) {
  await authorHeatmapOnQuery(page, {
    queryId: 1,
    heading: 'Rail Network Daily Ridership',
    x: 'line',
    y: 'date',
    value: 'vehicle_count',
  })
}

// Takes the heatmap authorTallHeatmap just created and puts it on a dashboard,
// so a spec can exercise the renderer in the dashboard-widget host rather than
// the query editor. The widget lands at the default 3x6, which react-grid-layout
// renders as a 375px-tall box, well under any viewport-relative bound; that is
// the whole point, since it is the host where the renderer has to take its
// height from its host rather than from the viewport.
//
// Every step after authoring is an in-app click, never a page.goto. The mock
// backend is an in-memory zustand store with no persistence, so a full reload
// destroys both the visualization this just created and the widget it is about
// to add.
export async function addHeatmapToDashboard(page: Page) {
  await page.getByRole('link', { name: 'Dashboards', exact: true }).click()
  await page.getByRole('link', { name: /Transportation Overview/ }).click()
  await expect(page.getByRole('heading', { name: /Transportation Overview/ })).toBeVisible()

  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Widget', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('textbox').fill('Rail Network')
  await dialog.getByRole('button', { name: /Rail Network Daily Ridership/ }).first().click()
  // Query 1 carries no parameters, so choosing the visualization adds the
  // widget outright with no mapping step in between.
  await dialog.getByRole('button', { name: /Heatmap/ }).first().click()
  await expect(dialog).not.toBeVisible()

  await expect(page.locator('[role="grid"]')).toBeVisible()

  // The new widget lands at the bottom of a dashboard that is already 1400px
  // tall, so it sits well below the fold. Anything measured with
  // document.elementFromPoint (which is how the specs check that a stuck header
  // is painted OVER the cells sliding under it, since a rect cannot see
  // stacking order) needs the widget inside the viewport: that call takes
  // VIEWPORT coordinates and simply returns null for a point below the fold.
  // Scrolling the grid item, not the grid, so the page moves and the renderer's
  // own scrollport stays where it is.
  await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]') as HTMLElement
    grid.closest('.react-grid-item')?.scrollIntoView({ block: 'center' })
  })
}

// Opens the dashboard widget's own "Expand" dialog on the heatmap widget.
// Scoped to the card that actually holds the grid, not the first Expand button
// on the page, which belongs to a chart widget that was already on this
// dashboard.
export async function openExpandedWidgetDialog(page: Page) {
  const card = page.locator('.react-grid-item').filter({ has: page.locator('[role="grid"]') })
  await card.getByRole('button', { name: 'Expand' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('[role="grid"]').waitFor()
  return dialog
}

// The edit/new visualization dialog, configured for a tall heatmap and left
// OPEN. The second of the two dialog hosts that opt into DialogWrapper's `fill`,
// and the one where the renderer sits two layers deep (dialog body -> preview
// column -> preview pane), so a floor anywhere in that chain clips rather than
// scrolls.
export async function openHeatmapPreviewDialog(page: Page) {
  await configureHeatmapDialog(page, {
    queryId: 1,
    heading: 'Rail Network Daily Ridership',
    x: 'line',
    y: 'date',
    value: 'vehicle_count',
  })
  const dialog = page.getByRole('dialog')
  await dialog.locator('[role="grid"]').waitFor()
  return dialog
}

