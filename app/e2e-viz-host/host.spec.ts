import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const ASSETS_ORIGIN = 'http://assets.veodyn.test'
const GEOMETRY = readFileSync(join(process.cwd(), 'packages/viz/fixtures/host/public/geo/world-countries.geojson'), 'utf8')

test.beforeEach(async ({ page }) => {
  await page.route(`${ASSETS_ORIGIN}/geo/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/geo+json',
      headers: { 'access-control-allow-origin': '*' },
      body: GEOMETRY,
    })
  )
})

test.describe('a host page with no Tailwind rendering the built package', () => {
  test('renders each shared visualization natively', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('[data-veodyn-type="CHART"] [data-veodyn-part="chart"]').first()).toBeVisible()
    await expect(page.locator('[data-veodyn-type="TABLE"] [data-veodyn-part="table-row"]').first()).toBeVisible()
    await expect(page.locator('[data-veodyn-type="COUNTER"] [data-veodyn-part="counter-value"]')).toHaveText('1,234')
    await expect(page.locator('[data-veodyn-type="HEATMAP"] [data-veodyn-part="heatmap-cell"]').first()).toBeVisible()
  })

  test('lets a host rule restyle a part, whatever its specificity', async ({ page }) => {
    await page.goto('/')

    const label = page.locator('[data-veodyn-type="COUNTER"] [data-veodyn-part="counter-label"]')
    await expect(label).toHaveCSS('color', 'rgb(1, 2, 3)')
  })

  test('inherits the host font', async ({ page }) => {
    await page.goto('/')

    const value = page.locator('[data-veodyn-type="COUNTER"] [data-veodyn-part="counter-value"]')
    await expect(value).toHaveCSS('font-family', /Courier New/)
  })

  test('takes the host palette through the documented variables', async ({ page }) => {
    await page.goto('/')

    const swatch = page.locator('[data-veodyn-type="CHART"] [data-slot="legend-swatch"]').first()
    await expect(swatch).toHaveCSS('background-color', 'rgb(255, 0, 0)')
  })

  test('takes the host palette in a dark provider too', async ({ page }) => {
    await page.goto('/')

    const swatch = page.locator('#dark-host [data-veodyn-type="CHART"] [data-slot="legend-swatch"]').first()
    await expect(swatch).toHaveCSS('background-color', 'rgb(255, 0, 0)')
  })

  test('leaves the host page outside the widget unstyled by the package', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('#host-flex')).toHaveCSS('display', 'block')
    await expect(page.locator('#host-padding')).toHaveCSS('padding-top', '0px')
  })

  test('keeps a portalled tooltip inside the scoped root', async ({ page }) => {
    await page.goto('/')

    await page.locator('[data-veodyn-type="HEATMAP"] [data-veodyn-part="heatmap-cell"]').first().hover()
    const tooltip = page.locator('[data-veodyn-part="tooltip"][role="tooltip"]')
    await expect(tooltip).toBeAttached()
    expect(await tooltip.evaluate((node) => node.closest('.veodyn') !== null)).toBe(true)
  })

  test('loads choropleth geometry from the assets origin it was given and draws the map', async ({ page }) => {
    const geometry = page.waitForResponse((response) => response.url().endsWith('/geo/world-countries.geojson'))

    await page.goto('/')

    const response = await geometry
    expect(new URL(response.url()).origin).toBe(ASSETS_ORIGIN)
    expect(response.ok()).toBe(true)
    await expect(page.locator('[data-veodyn-type="CHOROPLETH"] [data-veodyn-part="map"]')).toBeVisible()
  })

  test('lets a server component normalize a payload through the server entry', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('server-normalized')).toHaveText('Riders by route')
  })
})
