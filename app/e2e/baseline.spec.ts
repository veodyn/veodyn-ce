import { expect, test, type Page } from '@playwright/test'

// Mock mode (NEXT_PUBLIC_REDASH_URL unset) normally auto-authenticates the
// mock user. Fall back to the mock login form if it appears.
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

// Structural screens only: sidebar nav, headings, tabs, tables, cards and
// badges, which is the chrome every other screen is built out of, so a change
// to a shared primitive shows up here first. The query editor (Monaco) and
// dashboard detail (chart/map widgets) render non-deterministic pixels and are
// intentionally excluded from the pixel baseline. See e2e/README.md for how to
// add masked captures for those if needed.
const SCREENS = [
  { name: 'home', path: '/' },
  { name: 'queries-list', path: '/queries' },
  { name: 'dashboards-list', path: '/dashboards' },
]

// Known artifact: the dev server's own overlay button is fixed-position, so a
// full-page capture puts it over the sidebar and it lands in these baselines.
// It predates them, sits in the same place every run, and is well inside
// maxDiffPixelRatio, so it costs nothing. It is dev-server furniture, not
// product UI: do not read it as a rendering bug. Hiding it needs a selector
// that survives Next upgrades, and the obvious ones (nextjs-portal,
// data-nextjs-dev-tools-button) match nothing on Next 16.
test('golden-path baseline screenshots', async ({ page }) => {
  await ensureAuthed(page)

  for (const screen of SCREENS) {
    await page.goto(screen.path)
    await page.waitForLoadState('networkidle')
    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    })
  }
})
