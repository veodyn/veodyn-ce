import { expect, test, type Page } from '@playwright/test'

// Two things here that a jsdom test cannot reach.
//
// The basemap case turns on the difference between the reader's choice and the
// OS setting, so it needs a browser where those two genuinely disagree: the app
// preference is written to localStorage before load while the emulated OS stays
// light. Under the old implementation the map read prefers-color-scheme, so it
// fetched the light basemap here and this fails.
//
// The pinned-token case is pure cascade. A unit test can assert which values the
// palette holds; whether an inline custom property actually beats an ancestor
// `.dark` for the utilities underneath is something only a real engine resolves,
// and a scope CLASS did not (see widget-theme-palette.ts).

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

test.use({ colorScheme: 'light' })

test('the basemap follows the reader\'s choice, not their OS', async ({ page }) => {
  await ensureAuthed(page)
  await page.addInitScript(() => window.localStorage.setItem('veodyn.theme', 'dark'))

  const darkStyle = page.waitForRequest(
    (request) => request.url().includes('dark-matter-gl-style'),
    { timeout: 15_000 }
  )

  await page.goto('/queries/3')
  await page.getByRole('tab', { name: 'Station Map' }).click()

  // Resolves only if the dark basemap was actually requested. The assertion is
  // the await itself; the expect below just states the outcome.
  await expect(darkStyle).resolves.toBeTruthy()

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('inline tokens override an ancestor .dark for the utilities beneath', async ({ page }) => {
  await ensureAuthed(page)

  const colors = await page.evaluate(() => {
    const outer = document.createElement('div')
    outer.className = 'dark'

    // What WidgetThemeBoundary does when it pins light: the raw tokens as
    // inline custom properties. Only --background is needed to prove the
    // mechanism; the component sets the whole set from widget-theme-palette.ts.
    const pinned = document.createElement('div')
    pinned.style.setProperty('--background', '#F7F5F0')
    const pinnedProbe = document.createElement('div')
    pinnedProbe.className = 'bg-background'
    pinned.appendChild(pinnedProbe)

    // A sibling with no override, to show the ancestor really is dark and the
    // assertion is not passing because nothing was dark in the first place.
    const inheritedProbe = document.createElement('div')
    inheritedProbe.className = 'bg-background'

    outer.append(pinned, inheritedProbe)
    document.body.appendChild(outer)

    const read = (el: Element) => getComputedStyle(el).backgroundColor
    const result = { pinnedLight: read(pinnedProbe), inheritedDark: read(inheritedProbe) }
    outer.remove()
    return result
  })

  expect(colors.pinnedLight).not.toBe(colors.inheritedDark)
  expect(colors.pinnedLight).toBe('rgb(247, 245, 240)')
  expect(colors.inheritedDark).toBe('rgb(11, 14, 20)')
})

function relativeLuminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((channel) => {
    const unit = channel / 255
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(first: string, second: string): number {
  const [light, dark] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

test('a marker popup in the dark theme is readable and its tip matches its box', async ({ page }) => {
  await ensureAuthed(page)
  await page.addInitScript(() => window.localStorage.setItem('veodyn.theme', 'dark'))

  await page.goto('/queries/3')
  await page.getByRole('tab', { name: 'Station Map' }).click()
  await page.locator('.maplibregl-marker').first().click()

  const popup = page.locator('[data-veodyn-part="map-popup"]')
  await expect(popup).toBeVisible()

  const colors = await popup.evaluate((text) => {
    const box = text.closest('.maplibregl-popup-content') as HTMLElement
    const tip = box.parentElement?.querySelector('.maplibregl-popup-tip') as HTMLElement
    return {
      text: getComputedStyle(text).color,
      box: getComputedStyle(box).backgroundColor,
      tip: getComputedStyle(tip).borderTopColor,
    }
  })

  expect(colors.box).not.toBe('rgb(255, 255, 255)')
  expect(contrastRatio(colors.text, colors.box)).toBeGreaterThanOrEqual(4.5)
  expect(colors.tip).toBe(colors.box)
})
