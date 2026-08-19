import { test, expect } from '@playwright/test'

// Regression guards for three fixes landed 2026-07-29 from the stage
// product-critic sweep (F-01, F-02, F-04). These read the real DOM rather than
// asserting classes: F-04 is a geometry claim, and the unit suite, lint and tsc
// all went green while the fix had reached only the loading branch of /profile
// and not the page anyone sees. Only a width measured in a browser caught that.
//
// F-03 (admin status honouring Settings > Formats) has no guard here on purpose:
// mock mode short-circuits that branch to "Status unavailable" via USE_REAL_API,
// so the timestamp never renders and any assertion would pass vacuously.

test.describe('triage fixes', () => {
  // F-04: /profile is a form page that was rendering at the `full` width, so
  // its 448px fields floated in an 1885px column and its 2-column tables
  // stretched to match. Its structural twin /users/[userId] is `narrow`.
  test('F-04: profile constrains its column and its tables', async ({ page }) => {
    await page.goto('/profile')
    await page.waitForLoadState('networkidle')

    const shell = page.locator('main > div').first()
    const box = await shell.boundingBox()
    if (!box) throw new Error('profile shell rendered no box')

    // max-w-3xl is 48rem = 768px. Assert the cap, not a screenshot.
    expect(await shell.evaluate((el) => getComputedStyle(el).maxWidth)).toBe('768px')
    expect(box.width).toBeLessThanOrEqual(768)

    // The cap has to reach the tables too, or the fix only moved the problem.
    const table = page.locator('table').first()
    if (await table.count()) {
      const tableBox = await table.boundingBox()
      if (tableBox) expect(tableBox.width).toBeLessThanOrEqual(768)
    }
  })

  // F-04 guard: the width must not snap between the loading branch and the
  // resolved page. All four PageContainers on the route carry the same width.
  test('F-04: the width does not change once the page resolves', async ({ page }) => {
    await page.goto('/profile')
    const shell = page.locator('main > div').first()
    const early = await shell.evaluate((el) => getComputedStyle(el).maxWidth)
    await page.waitForLoadState('networkidle')
    const settled = await shell.evaluate((el) => getComputedStyle(el).maxWidth)

    // Assert the value, not just that the two agree. Comparing them alone
    // passed while BOTH were "none" and the fix had reached neither branch,
    // which is the one outcome this test exists to catch.
    expect(early).toBe('768px')
    expect(settled).toBe('768px')
  })

  // F-02: Home's freshness cards come from useCatalog and link to
  // /data/dataset/:id, so calling them "Feeds" collided with the separate
  // useCaptures resource that /captures reports on.
  test('F-02: Home labels dataset freshness as Freshness, not Feeds', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const strip = page.locator('main')
    // Scope to the strip's own sub-headings; "feed" appears in prose elsewhere.
    const subHeadings = await strip.locator('h3').allTextContents()
    expect(subHeadings).not.toContain('Feeds')

    // Only assert the rename if the strip rendered at all: it returns null
    // when there is no notable data, and a vacuous pass would hide that.
    if (subHeadings.some((h) => h === 'Freshness')) {
      await expect(strip.locator('a[href^="/data/dataset/"]').first()).toBeVisible()
    }
  })

  // F-13: /destinations and /data-sources rendered an empty grid under a
  // "N destinations" count, while 33 other files reach for NoData.
  //
  // Both fixtures ship rows, so filtering is the only way to reach the empty
  // branch here. That is the half worth testing anyway: "you have none" and
  // "your filter excluded them all" are different problems, and one shared
  // "no data" over a filtered list reads as data loss. The unfiltered message
  // is the same ternary with the other string, and it is what was observed
  // broken on stage, where /destinations really does have zero.
  //
  // networkidle is not enough on these two routes: it fires before the list
  // resolves, so wait for a row before touching the filter.
  for (const c of [
    { route: '/destinations', filtered: /No destination matches that search/, unfiltered: /No alert destinations yet/ },
    { route: '/data-sources', filtered: /No data source matches that search/, unfiltered: /No data sources yet/ },
  ]) {
    test(`F-13: ${c.route} blames the filter, not the data`, async ({ page }) => {
      await page.goto(c.route)
      await expect(page.locator('[data-slot=card]').first()).toBeVisible({ timeout: 15000 })

      await page.getByPlaceholder(/Search by name or type/).fill('zzzz-no-such-thing')

      await expect(page.getByText(c.filtered)).toBeVisible()
      // The wrong message here would be the actively misleading one.
      await expect(page.getByText(c.unfiltered)).toHaveCount(0)
      await expect(page.locator('[data-slot=card]')).toHaveCount(0)
    })
  }

  // F-06: /queries and /dashboards hand-rolled a tab strip that reimplemented
  // ui/tabs variant="line", and measured 32px against the primitive's 25px on
  // /users and /settings. They now go through ListPageTabs.
  //
  // The reason they were hand-rolled is the thing worth guarding: these tabs
  // are real routes, and TabsTrigger is a <button>. If the `render` escape
  // hatch ever stops producing a real anchor, the tabs keep working on click
  // and silently lose middle-click, open-in-new-tab, and copy-link.
  for (const c of [
    { route: '/queries', tab: 'My Queries', expect: /[?&]tab=my/ },
    { route: '/dashboards', tab: 'My Dashboards', expect: /[?&]tab=my/ },
  ]) {
    test(`F-06: ${c.route} tabs are real links and still navigate`, async ({ page }) => {
      await page.goto(c.route)
      const target = page.getByRole('tab', { name: c.tab })
      await expect(target).toBeVisible({ timeout: 15000 })

      // A real anchor with a real href, not a button with an onClick.
      expect(await target.evaluate((el) => el.tagName)).toBe('A')
      expect(await target.getAttribute('href')).toMatch(c.expect)

      await target.click()
      await expect(page).toHaveURL(c.expect)
      // aria-selected, not Base UI's data-active: it is what a screen reader
      // reads, so asserting it also proves the tab semantics survived the swap
      // from a plain <a> to a rendered TabsTrigger.
      await expect(page.getByRole('tab', { name: c.tab })).toHaveAttribute('aria-selected', 'true')
    })
  }

  // F-01: the chip printed Math.abs(delta) raw, so a hair-width KPI change
  // rendered "-0.0035567007803818 mph" beside a value of "1.582 mph".
  test('F-01: no KPI delta prints a long raw float', async ({ page }) => {
    await page.goto('/kpis')
    await page.waitForLoadState('networkidle')

    const body = await page.locator('main').innerText()
    // Five or more decimals in a rendered number is the defect's signature.
    expect(body).not.toMatch(/\d\.\d{5,}/)
  })
})
