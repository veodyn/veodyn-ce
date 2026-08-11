import { expect, test, type Page } from '@playwright/test'
import { SKIP_UNLESS_AI, aiEnabledOnServer } from './ai-posture'

// Whether the picked visualization *looks* picked.
//
// This is an e2e test rather than a unit one because the answer is a computed
// style: the state lives in a `data-checked` attribute and Tailwind turns that
// into a border, a ring and a tint. jsdom computes none of it, so a unit test
// can only assert the attribute, which was never the thing in doubt.
//
// The failure mode is documented on this same screen: the dimension chips used
// to mark their on state with one step of background against a near-identical
// background, which read as "nothing is selected", and hovering an unselected
// chip then looked exactly like a selected one.
//
// An AI spec, because the picker lives in the Visual builder and Visual mode
// only exists when ai.enabled is on. It is named `ai-*` and listed in
// playwright.ai.config.ts so its posture actually runs somewhere; under the
// default run it skips.
async function openPicker(page: Page) {
  await page.goto('/queries/new')
  await page.waitForLoadState('networkidle')
  await page.getByRole('tab', { name: 'Visual' }).click()
  await page.getByRole('region', { name: 'Visualization' }).waitFor()
}

function boxOf(page: Page, label: string) {
  return page.getByRole('radio', { name: label }).evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      borderColor: style.borderTopColor,
      hasRing: style.boxShadow !== 'none' && style.boxShadow !== '',
      checked: el.getAttribute('aria-checked'),
    }
  })
}

test('the picked visualization reads as picked, and hover does not fake it', async ({
  page,
  request,
}) => {
  test.skip(!(await aiEnabledOnServer(request)), SKIP_UNLESS_AI)
  await openPicker(page)

  await page.getByRole('radio', { name: 'Bar' }).click()
  // Park the pointer off every tile: hover is the thing under test, so it must
  // not be sitting on one of the samples.
  await page.mouse.move(5, 500)

  const unpicked = await boxOf(page, 'Pie')
  expect(unpicked.checked).toBe('false')
  expect(unpicked.hasRing).toBe(false)

  // Polled, not measured once: these borders animate (`transition-colors`), and
  // read immediately after the click the picked tile still reports the colour it
  // is transitioning away from.
  await expect
    .poll(async () => (await boxOf(page, 'Bar')).borderColor)
    .not.toBe(unpicked.borderColor)

  // Two signals, not one: the border has changed colour, and a ring appears.
  const picked = await boxOf(page, 'Bar')
  expect(picked.checked).toBe('true')
  expect(picked.hasRing).toBe(true)

  // Hovering an unpicked tile may light it up, but it must not borrow the
  // picked tile's border: that is what made the old chips ambiguous.
  await page.getByRole('radio', { name: 'Pie' }).hover()
  const hovered = await boxOf(page, 'Pie')
  expect(hovered.checked).toBe('false')
  expect(hovered.borderColor).not.toBe(picked.borderColor)
  expect(hovered.hasRing).toBe(false)
})

test('the picker keeps one choice checked and moves it with the keyboard', async ({
  page,
  request,
}) => {
  test.skip(!(await aiEnabledOnServer(request)), SKIP_UNLESS_AI)
  await openPicker(page)

  // Table is where it starts: the plainest visualization, and the one an
  // unconfigured run can always render.
  await expect(page.getByRole('radio', { name: 'Table' })).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('radio', { name: 'Table' }).press('ArrowRight')

  await expect(page.getByRole('radio', { name: 'Line' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Table' })).toHaveAttribute('aria-checked', 'false')
})
