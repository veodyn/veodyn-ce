import { expect, type Page } from '@playwright/test'

// Authoring a heatmap through the visualization dialog, split out of
// ./heatmap-interaction-helpers.ts for file size only. That file is the setup
// surface ten heatmap specs import from; this is the dialog-driving half of it,
// and nothing outside imports these directly.
//
// The dependency runs one way on purpose: this module imports nothing from
// heatmap-interaction-helpers, so the two do not form a cycle. ensureAuthed
// came along for that reason, being the only thing configureHeatmapDialog
// needed from over there.

// Mirrors the helper in e2e/baseline.spec.ts and
// e2e/data-catalog.spec.ts.
export async function ensureAuthed(page: Page) {
  await page.goto('/')
  const email = page.getByRole('textbox', { name: /email/i })

  if (await email.isVisible().catch(() => false)) {
    await email.fill('admin@example.com')
    await page.getByLabel(/password/i).fill('mock')
    await page.getByRole('button', { name: /sign in/i }).click()
  }

  await page.waitForLoadState('networkidle')
}

export interface HeatmapFixture {
  queryId: number
  heading: string
  x: string
  y: string
  value: string
}

// Opens the visualization dialog on a query and configures it as a heatmap,
// stopping before Save so a caller can either save it or measure the dialog
// itself.
export async function configureHeatmapDialog(page: Page, fixture: HeatmapFixture) {
  await ensureAuthed(page)
  await page.goto(`/queries/${fixture.queryId}`)
  await expect(page.getByRole('heading', { name: fixture.heading, level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Add visualization' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Type -> Heatmap. Safe to grab the dialog's first combobox positionally
  // only because this is the very first control clicked: before Heatmap is
  // chosen, TableEditor (the default type) has not rendered any comboboxes of
  // its own yet, so exactly one exists.
  await dialog.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Heatmap' }).click()

  const mapColumn = async (column: string, role: string) => {
    const row = dialog.locator('div.flex.items-center.gap-2').filter({ hasText: column })
    await row.getByRole('combobox').click()
    await page.getByRole('option', { name: role }).click()
  }
  await mapColumn(fixture.x, 'X (columns)')
  await mapColumn(fixture.y, 'Y (rows)')
  await mapColumn(fixture.value, 'Value')
  // Aggregation is left at its default, Sum, which the hand-computed sums
  // above are computed against.
}

export async function authorHeatmapOnQuery(page: Page, fixture: HeatmapFixture) {
  await configureHeatmapDialog(page, fixture)
  const dialog = page.getByRole('dialog')

  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).not.toBeVisible()

  await page.getByRole('tab', { name: 'Heatmap' }).click()
}
