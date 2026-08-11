import { expect, test } from '@playwright/test'

// Adding a visualization, end to end: the editor opens on a mapping that draws
// something, and Save puts the result on screen.
//
// Both halves were reported from a real instance and neither is visible to the
// unit suite on its own. The mapping is a rendering question (does the preview
// panel contain a chart, or an empty box?), and the tab is a question about the
// page: the tab strip's list belongs to the query fetched by `useQueryById`, so
// whether a create ever reaches it depends on a cache key two files away.
//
// Query 1 returns date, line and vehicle_count, so there is exactly one numeric
// column to plot and one string column that should be left alone.
test.beforeEach(async ({ page }) => {
  await page.goto('/queries/1')
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Add visualization' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByLabel('Type').click()
  await page.getByRole('option', { name: 'Chart', exact: true }).click()
})

test('a new chart opens on a mapping that draws, not on every column unused', async ({ page }) => {
  const dialog = page.getByRole('dialog')

  // What the renderer already infers, now said out loud by the editor.
  await expect(dialog.getByLabel('Role for date')).toContainText('X Axis')
  await expect(dialog.getByLabel('Role for vehicle_count')).toContainText('Y Axis')
  // A string column is not a series until someone asks for one.
  await expect(dialog.getByLabel('Role for line')).toContainText('-- unused --')

  // And the preview is a chart rather than an empty panel. Bar rather than the
  // default line, because bar is what the report was about: its marks are rects,
  // which are only drawn once there is a y column to draw them from.
  await dialog.getByLabel('Chart Type').click()
  await page.getByRole('option', { name: 'Bar', exact: true }).click()

  // Inside the responsive container, and counting bars rather than surfaces: a
  // recharts legend icon is itself an `svg.recharts-surface`, so a bare surface
  // locator finds a 14px icon and passes over an empty plot.
  const plot = dialog.locator('.recharts-responsive-container')
  await expect(plot).toBeVisible()
  await expect
    .poll(async () => await plot.locator('.recharts-bar-rectangle').count())
    .toBeGreaterThan(0)
})

test('Save adds the visualization and selects its tab', async ({ page }) => {
  const dialog = page.getByRole('dialog')
  const name = dialog.getByLabel('Name')
  await name.fill('Daily Vehicles')
  await dialog.getByRole('button', { name: 'Save' }).click()

  // The tab strip reads from the query, not from the dialog, so this only appears
  // once the create has invalidated the query the visualization belongs to.
  const tab = page.getByRole('tab', { name: 'Daily Vehicles' })
  await expect(tab).toBeVisible()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  // Selected is not enough: the panel behind it has to be the new chart, drawn
  // from the mapping the dialog seeded.
  const panel = page.getByRole('tabpanel').locator('.recharts-responsive-container')
  await expect(panel).toBeVisible()
  await expect.poll(async () => await panel.locator('.recharts-line, .recharts-bar').count()).toBeGreaterThan(0)
})
