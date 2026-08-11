import { expect, test, type Page } from '@playwright/test'
import { SKIP_UNLESS_AI, aiEnabledOnServer } from './ai-posture'

// The Create-with-AI entry point on the five library pages, and the chat it
// opens.
//
// ai.enabled is server-side instance config read once at server start, and Next
// refuses to run a second dev server from the same directory, so the posture is
// a property of the web server the run booted. This file covers both, like
// every other AI spec (see e2e/ai-posture.ts):
//
//   pnpm test:e2e     -> neutral config, ai.enabled false. The disabled test
//                        runs and the enabled one skips.
//   pnpm test:e2e:ai  -> playwright.ai.config.ts boots the same app with
//                        VEODYN_AI__ENABLED=true. The enabled test runs and the
//                        disabled one skips. The spec has to be named in that
//                        config's testMatch or this half never runs at all.
//
// The enabled half is reproducible because mock mode answers /api/ai/converse
// from mockConverse in src/lib/ai-mock.ts: one scripted follow-up while the
// transcript holds a single user message, then a fixed proposal. No clock and
// no randomness, so the same answers always reach the same query.

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

// A route the dev server has not compiled yet takes well over the default 5s
// expect timeout to commit its first client-side navigation or first paint.
const SURFACE_TIMEOUT = 60_000

// Every library page that gains the button, with the manual button it has to
// keep. Kept as data so the disabled half cannot quietly cover four of five.
const LIBRARY_PAGES = [
  { path: '/queries', manual: 'New Query' },
  { path: '/dashboards', manual: 'New Dashboard' },
  { path: '/kpis', manual: 'New KPI' },
  { path: '/reports', manual: 'New Report' },
  { path: '/query-snippets', manual: 'New Snippet' },
]

// Both tests drive a cold dev server through five routes it compiles on first
// hit, and the enabled one walks a whole conversation and a write, so the
// default 30s per-test budget is not enough for the first run of the day.
test.describe.configure({ timeout: 180_000 })

test('AI disabled: no Create-with-AI door on any library page, and every manual button still works', async ({
  page,
  request,
}) => {
  test.skip(
    await aiEnabledOnServer(request),
    'this server has ai.enabled true, so the disabled posture is covered by the plain pnpm test:e2e run'
  )

  const pageErrors: Error[] = []
  const aiRequests: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error))
  page.on('request', (req) => {
    if (new URL(req.url()).pathname.startsWith('/api/ai/')) aiRequests.push(req.url())
  })

  await ensureAuthed(page)

  for (const { path, manual } of LIBRARY_PAGES) {
    await page.goto(path)

    // The positive assertion first, and on the same page. An absence check on a
    // page that never rendered passes for the wrong reason, which is the way
    // this kind of test usually fails to be able to fail.
    await expect(page.getByRole('button', { name: manual })).toBeVisible({
      timeout: SURFACE_TIMEOUT,
    })

    // Not a disabled button and not a tooltip: AI off means the door is not
    // there (spec section 2).
    await expect(page.getByRole('button', { name: 'Create with AI' })).toHaveCount(0)
    await expect(page.getByText('Create with AI', { exact: true })).toHaveCount(0)
  }

  // ── The manual buttons are not just present, they still do their job ───────
  // Two shapes to cover: the ones that navigate, and the ones that open a
  // dialog on the spot.
  await page.goto('/kpis')
  await page.getByRole('button', { name: 'New KPI' }).click()
  await expect(page).toHaveURL(/\/kpis\/new$/, { timeout: SURFACE_TIMEOUT })
  await expect(page.getByLabel('KPI name')).toBeVisible({ timeout: SURFACE_TIMEOUT })

  await page.goto('/reports')
  await page.getByRole('button', { name: 'New Report' }).click()
  await expect(page).toHaveURL(/\/reports\/new$/, { timeout: SURFACE_TIMEOUT })
  await expect(page.getByLabel('Report title')).toBeVisible({ timeout: SURFACE_TIMEOUT })

  // /queries/new is the Monaco editor, which e2e/ai-editor.spec.ts already
  // boots; here the link only has to still point at it.
  await page.goto('/queries')
  await expect(page.getByRole('button', { name: 'New Query' })).toHaveAttribute(
    'href',
    '/queries/new',
    { timeout: SURFACE_TIMEOUT }
  )

  await page.goto('/dashboards')
  await page.getByRole('button', { name: 'New Dashboard' }).click()
  await expect(page.getByRole('heading', { name: 'Create a New Dashboard' })).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })

  await page.goto('/query-snippets')
  await page.getByRole('button', { name: 'New Snippet' }).click()
  await expect(page.getByRole('heading', { name: 'New Query Snippet' })).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })

  // No library page ever reached for a model, not even to ask whether it could.
  expect(aiRequests).toEqual([])
  expect(pageErrors.map((error) => error.message)).toEqual([])
})

test('AI enabled: the chat interviews, proposes a query, and creates the one the card shows', async ({
  page,
  request,
}) => {
  test.skip(!(await aiEnabledOnServer(request)), SKIP_UNLESS_AI)

  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await ensureAuthed(page)
  await page.goto('/queries')

  // ── The door ──────────────────────────────────────────────────────────────
  const opener = page.getByRole('button', { name: 'Create with AI' })
  await expect(opener).toBeVisible({ timeout: SURFACE_TIMEOUT })
  // The manual button is beside it, not replaced by it.
  await expect(page.getByRole('button', { name: 'New Query' })).toBeVisible()

  await opener.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAccessibleName('Create a query with AI')

  // ── How it opens ──────────────────────────────────────────────────────────
  // The cursor is already in the composer, so the first message can just be
  // typed. Focus otherwise lands on the transcript's scroll region, which is
  // the first tabbable thing in the panel and not where anyone is going.
  await expect(dialog.getByLabel('Message the AI')).toBeFocused()
  // And the page behind is dimmed, not blurred. Only a real browser can settle
  // this: a unit test can read the class list, but whether a backdrop-filter
  // ends up applied is the computed style's answer.
  await expect(page.locator('[data-slot=dialog-overlay]')).toHaveCSS('backdrop-filter', 'none')

  // ── Turn one: a goal, and the model asks a follow-up rather than guessing ──
  await dialog.getByLabel('Message the AI').fill('which devices report the most often')
  await dialog.getByRole('button', { name: 'Send' }).click()

  await expect(dialog.getByText(/Which dataset should this read/)).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })
  // Nothing is proposed yet: a follow-up turn has no card and nothing to write.
  await expect(dialog.getByRole('button', { name: 'Create query' })).toHaveCount(0)

  // ── Turn two: answering with a suggested chip settles it ──────────────────
  await dialog.getByRole('button', { name: 'Last 30 days' }).click()

  await expect(dialog.getByText('Create this query')).toBeVisible({
    timeout: SURFACE_TIMEOUT,
  })
  // The SQL is grounded in a table the mock catalog actually has, and it is
  // shown read-only: the only ways to change it are the chat or the editor.
  const sql = dialog.getByLabel('Generated SQL')
  await expect(sql).toContainText('vehicle_locations')
  await expect(dialog.getByText('Reads vehicle_locations.')).toBeVisible()

  // ── The card's edits are what gets written, not the proposal ──────────────
  // A card that renders an edit and then commits the model's original is the
  // defect this asserts against, so the name that lands is a name the model
  // never produced.
  const name = dialog.getByLabel('Query name')
  await expect(name).toHaveValue('vehicle_locations by device_id')
  await name.fill('Device chattiness, renamed by hand')

  await dialog.getByRole('button', { name: 'Create query' }).click()

  // ── It exists, and the user is standing on it ─────────────────────────────
  await expect(page).toHaveURL(/\/queries\/\d+$/, { timeout: SURFACE_TIMEOUT })
  // The conversation is over, so the modal that held it is gone.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Device chattiness, renamed by hand' })
  ).toBeVisible({ timeout: SURFACE_TIMEOUT })

  expect(pageErrors.map((error) => error.message)).toEqual([])
})
