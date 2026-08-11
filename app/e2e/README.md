# The Playwright suite

Browser tests that run the real app against the bundled fixtures. Playwright
boots its own dev server in **mock mode** (`NEXT_PUBLIC_REDASH_URL` unset) on
**port 3100** and drives it, so a run needs no backend, no database and no
credentials.

It is **not wired into CI**. Nothing in `ci/` or `.github/workflows/` runs
Playwright, so this is a local, pre-merge check: if you do not run it, nobody
does.

## What is here

28 spec files and four helper modules, about 62 tests. Most of them assert
behaviour and computed style rather than pixels:

- **Charts and theming**: `chart-theme-tokens`, `chart-date-format`,
  `chart-headroom`, `map-theme`, `map-height`. These are why the suite exists.
  A chart that hardcodes a colour, loses its axis format or clips its top row
  is invisible to the unit tests, which never render.
- **Heatmap**: nine specs plus three helpers, covering sticky headers, tooltip
  placement, scroll dynamics, and the dashboard and dialog surfaces. The most
  interaction-heavy component in the product has the most coverage here.
- **Visualization authoring**: `viz-save-flow`, `viz-dialog-size`,
  `widget-edit-viz`, `ai-viz-picker`.
- **AI surfaces**: `ai-create-chat`, `ai-editor`, and `ai-posture.ts`, the
  shared assertion that AI affordances are **absent** rather than greyed out
  when AI is off.
- **Everything else**: `data-catalog`, `embed-render`, `tooltips`,
  `items-table-header`, `dialog-portal`, `draft-flag-check`, `avatar-check`,
  `triage-fixes`.

## The pixel baseline is one spec of the 28

`baseline.spec.ts` is the only file that calls `toHaveScreenshot`. It captures
three structural screens, `/`, `/queries` and `/dashboards`, at
`maxDiffPixelRatio: 0.01`. The query editor (`/queries/[id]/source`, Monaco)
and dashboard detail (`/dashboards/[id]`, chart and map widgets) are
deliberately excluded: they render non-deterministic pixels and cannot produce
a stable capture. To cover one later, add a masked capture,
`toHaveScreenshot(..., { mask: [locator] })`, over the region that moves.

Its baselines are committed under
`e2e/__screenshots__/baseline.spec.ts-snapshots/`. `test-results/` and
`playwright-report/` are transient and gitignored.

## Running it

From `app/`:

```bash
pnpm test:e2e                                  # the whole suite
pnpm test:e2e e2e/chart-theme-tokens.spec.ts   # one file
pnpm exec playwright test --update-snapshots   # regenerate the pixel baseline
```

`reuseExistingServer` is `false`, so each run boots its own server rather than
driving whatever happens to be on :3000. Set `PLAYWRIGHT_PORT` if something
already holds 3100.

A pixel diff means the rendered structure of a covered screen changed. Inspect
it under `test-results/`, then either fix the regression or regenerate the
baseline if the change was intended. A behavioural failure is an ordinary test
failure, and the diff is not where to look.
