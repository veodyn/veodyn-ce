import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ANONYMOUS_SCREENS,
  AUTHED_SCREENS,
  FORBIDDEN_ON_SCREEN,
  NEUTRAL_PACK_PROOF,
} from './docs-screens'

// Regenerates docs/static/img/screenshots/. Run it with:
//
//   pnpm screenshots:docs
//
// It writes straight into the docs tree, so the diff it produces IS the
// deliverable and should be reviewed image by image. See
// playwright.screenshots.config.ts for why this needs its own config.

const OUT_DIR = join(__dirname, '..', '..', 'docs', 'static', 'img', 'screenshots')

// Every route is being answered by a freshly built production server for the
// first time, and several of them fetch and draw a chart before they are worth
// photographing.
const SURFACE_TIMEOUT = 60_000

// Recharts animates on mount with its own JS timers, which `animations:
// 'disabled'` (a CSS and Web Animations control) does not reach. Without this
// the chart-heavy captures catch a half-drawn series. 1200ms clears the
// longest default recharts animation with room to spare.
const PAINT_SETTLE_MS = 1200

// The three images that are not a plain navigation in either table, named here
// so the completeness check at the bottom accounts for every file on disk.
const DRIVEN_SCREENS = ['chart-editor', 'visual-builder', 'ai-create-chat', 'kpi-new-source']

// The two images this harness cannot produce. Both managed-dataset surfaces
// read the sidecar with no mock branch, so mock mode paints an error state
// rather than the declarations the docs describe. Listed so the completeness
// check does not call the existing files orphans; they need a live backend.
const PACK_SCREENS = ['admin-managed-datasets', 'managed-dataset-records']

async function capture(page: Page, name: string) {
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(PAINT_SETTLE_MS)

  // The publication guard, on what was painted rather than on what the
  // fixtures hold. Runs BEFORE the write, so a contaminated surface never
  // reaches the docs tree even if someone ignores the failure.
  //
  // Line by line, not over the whole body flattened. innerText puts a newline
  // at every block boundary, so flattening it makes neighbouring elements read
  // as one phrase: the query list's tag chips are `metro`, `rail` and
  // `ridership` in three separate links, and flattened they spell a term on
  // this list that no fixture contains and no reader would ever see. A real
  // hit is a phrase inside one text node, so per-line matching keeps every
  // genuine detection and drops the manufactured adjacency.
  const lines = (await page.locator('body').innerText())
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const hits = FORBIDDEN_ON_SCREEN.filter((pattern) =>
    lines.some((line) => pattern.test(line))
  ).map(String)
  expect(hits, `${name} renders customer-identifying text under the neutral pack`).toEqual([])

  // A route this build does not serve paints Next's 404 inside the app shell,
  // so the sidebar renders and every guard above still passes. Fourteen pack
  // routes reached the docs tree that way, as one identical 404 image.
  expect(lines, `${name} captured a 404, so this route needs the composed tree`).not.toContain(
    'This page could not be found.'
  )

  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), animations: 'disabled' })
}

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

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true })
})

// Not `mode: 'serial'`: the captures share no state, so one unreachable route
// should cost one image, not skip every capture after it. fullyParallel is off
// in the config, which is what keeps them in one worker and in order so the
// count check at the end sees them all.
test.describe('signed in', () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthed(page)
  })

  test('the build is serving the neutral pack', async ({ page }) => {
    await page.goto('/dashboards')
    await expect(page.getByText(NEUTRAL_PACK_PROOF).first()).toBeVisible({
      timeout: SURFACE_TIMEOUT,
    })
  })

  for (const screen of AUTHED_SCREENS) {
    test(screen.name, async ({ page }) => {
      await page.goto(screen.path)
      await capture(page, screen.name)
    })
  }

  test('chart-editor', async ({ page }) => {
    // Dashboard 1's first widget is the line chart with a series mapping, so
    // the dialog opens on column mapping AND per-series controls, which is what
    // features/visualizations.md describes beneath this image.
    await page.goto('/dashboards/1')
    await page.waitForLoadState('networkidle')
    const pencil = page.getByRole('button', { name: 'Edit visualization' }).first()
    await expect(pencil).toBeVisible({ timeout: SURFACE_TIMEOUT })
    await pencil.click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: SURFACE_TIMEOUT })
    await capture(page, 'chart-editor')
  })

  test('kpi-new-source', async ({ page }) => {
    // The source-type control decides which source fields the form asks for, so
    // the state features/kpis.md documents is the one with a capture chosen,
    // not the default the plain kpi-new capture already shows.
    await page.goto('/kpis/new')
    const kind = page.getByRole('combobox', { name: 'Source type' })
    await expect(kind).toBeVisible({ timeout: SURFACE_TIMEOUT })
    await kind.click()
    await page.getByRole('option', { name: 'Capture', exact: true }).click()
    await expect(page.getByRole('combobox', { name: 'Capture' })).toBeVisible({
      timeout: SURFACE_TIMEOUT,
    })
    await capture(page, 'kpi-new-source')
  })

  test('visual-builder', async ({ page }) => {
    // The authoring mode tabs exist only when ai.enabled is true, which is why
    // the screenshot config boots with it on.
    await page.goto('/queries/new')
    const authoring = page.getByRole('tablist', { name: 'Authoring mode' })
    await expect(authoring).toBeVisible({ timeout: SURFACE_TIMEOUT })
    await authoring.getByRole('tab', { name: 'Visual' }).click()
    await expect(page.getByRole('region', { name: 'Visualization' })).toBeVisible({
      timeout: SURFACE_TIMEOUT,
    })
    await capture(page, 'visual-builder')
  })

  test('ai-create-chat', async ({ page }) => {
    // Captured mid-interview, on the turn features/ai.md describes: the model
    // has asked a grounding question and offered answer chips, and has not
    // proposed anything yet. The mock relay (src/lib/ai-mock.ts) scripts one
    // follow-up for a single-message transcript, so this turn is reproducible.
    await page.goto('/queries')
    const opener = page.getByRole('button', { name: 'Create with AI' })
    await expect(opener).toBeVisible({ timeout: SURFACE_TIMEOUT })
    await opener.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toHaveAccessibleName('Create a query with AI')
    await dialog.getByLabel('Message the AI').fill('which devices report the most often')
    await dialog.getByRole('button', { name: 'Send' }).click()
    await expect(dialog.getByText(/Which dataset should this read/)).toBeVisible({
      timeout: SURFACE_TIMEOUT,
    })
    await capture(page, 'ai-create-chat')
  })
})

test.describe('signed out', () => {
  // A fresh context per test, and never authenticated: mock mode signs the
  // mock user in on first load, so reusing the signed-in page would redirect
  // these three away from the screens they document.
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const screen of ANONYMOUS_SCREENS) {
    test(screen.name, async ({ page }) => {
      await page.goto(screen.path)
      await capture(page, screen.name)
    })
  }
})

test('every documented image is accounted for', () => {
  // The docs pages reference every image by name and `cd docs && pnpm build`
  // fails on a broken reference, so a capture silently dropped from the table
  // leaves a stale customer screenshot in place rather than an obvious hole.
  // This is the check that notices.
  //
  // Read off disk rather than from a counter this run incremented: Playwright
  // replaces the worker process after a failed test, which resets module
  // state, so an in-memory tally reports a number that has nothing to do with
  // how many images exist. The first run of this file said 3 with 45 captures
  // written.
  const onDisk = new Set(
    readdirSync(OUT_DIR)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace(/\.png$/, ''))
  )
  const expected = [...AUTHED_SCREENS, ...ANONYMOUS_SCREENS]
    .map((screen) => screen.name)
    .concat(DRIVEN_SCREENS)
    .concat(PACK_SCREENS)

  expect(expected.length).toBe(55)
  expect(expected.filter((name) => !onDisk.has(name))).toEqual([])
  expect([...onDisk].filter((name) => !expected.includes(name))).toEqual([])

  // PACK_SCREENS excuses three files from the orphan check above, so on its own
  // it would also excuse one the docs had stopped using. Each must still be
  // referenced by a docs page to earn the exemption.
  const DOCS_DIR = join(__dirname, '..', '..', 'docs', 'docs')
  const prose = readdirSync(DOCS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.md'))
    .map((file) => readFileSync(join(DOCS_DIR, file), 'utf8'))
    .join('\n')
  expect(PACK_SCREENS.filter((name) => !prose.includes(`${name}.png`))).toEqual([])
})
