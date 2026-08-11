import { expect, test, type Page } from '@playwright/test'

// Mock mode (NEXT_PUBLIC_REDASH_URL unset) normally auto-authenticates the
// mock user. Fall back to the mock login form if it appears. Mirrors the
// helper in e2e/baseline.spec.ts.
async function ensureAuthed(page: Page) {
  await page.goto('/')
  const email = page.getByRole('textbox', { name: /email/i })

  if (await email.isVisible().catch(() => false)) {
    await email.fill('admin@example.com')
    await page.getByLabel(/password/i).fill('mock')
    await page.getByRole('button', { name: /sign in/i }).click()
  }

  await page.waitForLoadState('networkidle')
}

// Demo scenario (b): a user browses the data catalog, opens a dataset, and
// lands in a working query from it. Structural assertions only (roles, text,
// URL shape), not pixel-exact: the goal is proving the click-path wires up,
// not locking down layout.
test('dataset catalog to query smoke (demo scenario b)', async ({ page }) => {
  await ensureAuthed(page)

  await page.goto('/data')
  await expect(page.getByRole('heading', { name: 'Data Catalog' })).toBeVisible()

  // Click the first dataset card. Capture its name before navigating so the
  // detail-page heading assertion checks real content instead of a
  // hardcoded fixture string.
  const firstCard = page.locator('a[href^="/data/dataset/"]').first()
  const datasetName = await firstCard.getByRole('heading', { level: 3 }).innerText()
  await firstCard.click()

  await expect(page).toHaveURL(/\/data\/dataset\//)
  await expect(page.getByRole('heading', { name: datasetName, level: 1 })).toBeVisible()

  // "Query this dataset" routes to either an existing query (view page) or
  // /queries/new (editor page) depending on whether the dataset has a
  // sample query wired up. Accept either destination and assert on
  // whichever query-execution surface it renders.
  await page.getByRole('button', { name: /query this dataset/i }).click()

  await expect(page).toHaveURL(/\/queries\//)
  const editorSurface = page.locator('#query-editor-container')
  const executeControl = page.getByRole('button', { name: /execute/i })
  // Exact, not /refresh/i. The query header also carries a schedule control
  // named "Refreshes daily at 06:00", so the loose pattern matched two buttons
  // and failed on strict mode rather than on anything being missing. What this
  // line means is the Refresh button specifically.
  const refreshControl = page.getByRole('button', { name: 'Refresh', exact: true })
  await expect(editorSurface.or(executeControl).or(refreshControl).first()).toBeVisible()
})
