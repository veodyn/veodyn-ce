import { expect, test, type Page } from '@playwright/test'

// An embed is the one surface where a broken visualization is invisible to us:
// it renders inside someone else's iframe, nobody on this team is looking at
// it, and "Unsupported visualization type" is a perfectly quiet failure. It is
// also a separate route from the query editor, and registration is per module
// graph, so a type can draw in the editor and be unknown here.
//
// The map is the reason this file exists. Its wrapper collapsed to zero height
// everywhere (see map-height.spec.ts) and the embed route has its own layout,
// so the fix has to be confirmed here as well as in the editor.

// Query -> visualization, from src/lib/mock-data/packs/neutral/queries-set-a.ts.
//
// `drawn` is per type on purpose. A single "is anything big on the page" rule
// looked tidy and reported the counter as broken: it draws a number and a
// label, no canvas and no svg, and it was rendering perfectly. A check that
// cries wolf on a working widget is worse than none, because the next person
// loosens it until it cannot fail at all.
const EMBEDS = [
  { query: 1, viz: 1, type: 'TABLE', drawn: 'table' },
  { query: 1, viz: 2, type: 'CHART', drawn: 'svg' },
  { query: 3, viz: 16, type: 'MAP', drawn: 'canvas' },
  { query: 5, viz: 10, type: 'COUNTER', drawn: 'text' },
] as const

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

for (const embed of EMBEDS) {
  test(`the ${embed.type} embed opens and draws something`, async ({ page }) => {
    await ensureAuthed(page)
    await page.goto(`/embed/query/${embed.query}/visualization/${embed.viz}`)
    await page.waitForLoadState('networkidle')

    // The quiet failures first, and by exact text: an embed that renders this
    // is a page that loaded fine and shows nothing a reader wants.
    await expect(page.getByText(/Unsupported visualization type/)).toHaveCount(0)
    await expect(page.getByText('No data available')).toHaveCount(0)
    await expect(page.getByText('Loading...')).toHaveCount(0)

    // Then that something was actually painted. A renderer that throws inside a
    // boundary, or draws into a zero-height box, leaves a page that passes
    // every assertion above.
    if (embed.drawn === 'text') {
      // The counter is a number and a caption, nothing to measure a box on.
      await expect(page.locator('body')).toContainText(/\d/)
      return
    }

    if (embed.type === 'TABLE') {
      // Rows as well as a box: an empty table still measures large enough to
      // clear the thresholds below.
      expect(await page.locator('table tbody tr').count()).toBeGreaterThan(0)
    }

    const box = await page.locator(embed.drawn).first().boundingBox()
    if (!box) throw new Error(`[embed] ${embed.type} rendered no ${embed.drawn}`)
    // Bigger than an icon. The map in particular used to mount its canvas at a
    // 300px default inside a zero-height container, so height is the assertion
    // that matters and not merely "an element exists".
    expect(box.width).toBeGreaterThan(200)
    expect(box.height).toBeGreaterThan(100)
  })
}

// The sidebar and app chrome belong to the app, not to whoever embedded this.
test('an embed renders bare, without the app shell', async ({ page }) => {
  await ensureAuthed(page)
  await page.goto('/embed/query/1/visualization/2')
  await page.waitForLoadState('networkidle')

  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Data Catalog' })).toHaveCount(0)
})

// /embed/* is a forcedTheme('light') surface (src/lib/theme-preference.ts): the
// appearance belongs to the host page, which we cannot see, so a reader's dark
// preference must not travel into somebody else's article.
test('an embed stays light even for a reader who chose dark', async ({ page }) => {
  await ensureAuthed(page)
  await page.addInitScript(() => window.localStorage.setItem('veodyn.theme', 'dark'))

  await page.goto('/embed/query/3/visualization/16')
  await page.waitForLoadState('networkidle')

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
