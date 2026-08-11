import { expect, test, type Page } from '@playwright/test'

// Mirrors the helper in e2e/baseline.spec.ts and
// e2e/chart-theme-tokens.spec.ts.
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

// Every <text> recharts emits for the x axis of the first chart on the page:
// tick labels and the second context line alike. Spaces are stripped because
// recharts' own <Text> word-wraps by splitting on them into separate <tspan>s,
// so "03:22 PM" reaches the DOM as "03:22PM" on the axes that use it.
async function xAxisLabels(page: Page): Promise<string[]> {
  const chart = page.locator('.recharts-wrapper').first()
  const labels = await chart.locator('.recharts-xAxis-tick-labels text').allTextContents()
  return labels.map((label) => label.replace(/\s+/g, ''))
}

// Picks a value in one of the Formats tab's two selects. They are Base UI
// selects, so the option list is a listbox rather than native <option>s.
async function chooseFormat(page: Page, label: RegExp, option: string) {
  await page.getByLabel(label).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

// The whole point of the feature, end to end through the real setting: an
// operator picks a display format in Settings and the charts follow it. No unit
// test can cover this path, because the setting reaches a chart through a query
// hook, four renderer props and recharts' own tick machinery.
test('a chart axis follows the display format an operator saves', async ({ page }) => {
  await ensureAuthed(page)

  // The dashboard first, to see the default form and to prove the assertion
  // below is a change rather than a coincidence. "Ridership Trend" is a daily
  // line chart, so its ticks are day-and-month with the year on a second line.
  await page.goto('/dashboards/1')
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible()
  const beforeSave = await xAxisLabels(page)

  // MM/DD/YY is the app-wide default with no org setting saved, so the ticks
  // read month-first before anything is changed.
  expect(beforeSave.some((label) => /^02\/\d{2}$/.test(label))).toBe(true)

  await page.goto('/settings')
  await page.getByRole('tab', { name: /formats/i }).click()
  await chooseFormat(page, /date format/i, 'DD/MM/YYYY')
  await chooseFormat(page, /time format/i, '12h (hh:mm AM/PM)')
  await page.getByRole('button', { name: /^save$/i }).click()
  await expect(page.getByText(/settings saved/i)).toBeVisible()

  // Client-side navigation only, deliberately: mock mode holds the saved setting
  // in the query cache, and a page.goto() would reload the app and drop it (see
  // use-org-settings.ts). Clicking is also the path an operator actually takes.
  await page.getByRole('link', { name: /^dashboards$/i }).first().click()
  await page.getByRole('link', { name: /transportation overview/i }).first().click()
  await expect(page.locator('.recharts-line-curve').first()).toBeVisible()

  await expect
    .poll(async () => (await xAxisLabels(page)).some((label) => /^\d{2}\/02$/.test(label)), {
      timeout: 15_000,
    })
    .toBe(true)

  const afterSave = await xAxisLabels(page)
  // Day-first now, and nothing left reading month-first: the axis did not end up
  // with one tick in each form.
  expect(afterSave.some((label) => /^02\/\d{2}$/.test(label))).toBe(false)
  // The year line under the ticks takes the four-digit year the setting asked
  // for, rather than the two digits the previous format used.
  expect(afterSave).toContain('2026')
})
