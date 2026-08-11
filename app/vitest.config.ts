import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

/**
 * How many times one SHAPE of repeated console output is allowed through.
 *
 * Keyed on shape rather than on the exact string, so a whole class of message
 * shares one budget instead of getting one budget per component name.
 */
const REPEAT_BUDGET = 3

const seenShapes = new Map<string, number>()

/**
 * Collapse a console line to the class of message it belongs to.
 *
 * Identifiers, quoted strings and numbers are stripped, so React's
 * "An update to <Component> inside a test was not wrapped in act(...)" folds to
 * a single key across every component that emits it.
 */
function shapeOf(log: string): string {
  return log
    .replace(/["'`][^"'`]*["'`]/g, '_')
    .replace(/\b[A-Z][A-Za-z0-9]+\b/g, '_')
    .replace(/\d+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    /**
     * Headroom for slow CI runners so async component tests do not flake.
     *
     * 20s was not enough, and the cap below does not make it enough. On
     * 2026-08-05 four frontend-test jobs sharing one runner produced 35
     * failures, 33 of them a bare `Test timed out in 20000ms` and the other two
     * an rAF count-up that never reached its final value. Every one of them
     * passed on a quiet runner. Phase time for identical work inflated 5.5x
     * under that contention, which turns any test with 4s of real work into a
     * timeout while it is still making progress.
     *
     * A timeout is meant to catch a test that is STUCK, not one that is slow,
     * and at 5x inflation those two stop being distinguishable at 20s. 60s in
     * CI restores the distinction: a starved run finishes slow and green
     * instead of fast and red.
     *
     * Kept at 20s locally, where nothing competes and a hang should surface in
     * seconds rather than in a minute. That asymmetry is the point: the extra
     * headroom exists for an environment, not for the tests.
     */
    testTimeout: process.env.CI ? 60_000 : 20_000,
    hookTimeout: process.env.CI ? 60_000 : 20_000,
    // Exclude the two Playwright dirs and deps from the vitest run. Both hold
    // `.spec.ts` files that vitest will happily collect and then fail on, since
    // a Playwright fixture (`page`) is not something vitest can supply:
    // e2e-docs/ was collected on its first run and failed the suite that way.
    exclude: ['e2e/**', 'e2e-docs/**', 'node_modules/**', '.next/**'],
    /**
     * CAP THE POOL IN CI, BECAUSE A CI RUNNER IS SHARED AND A LAPTOP IS NOT.
     *
     * Vitest sizes its worker pool from the HOST's cpu count, which inside a
     * container is the machine's cpus rather than this job's share of them. So
     * every job independently decides it may use about ten workers, no matter
     * how many jobs are already on the host.
     *
     * Measured 2026-08-05. Four frontend-test jobs started within 56 seconds of
     * each other on one runner and all four failed at ~2270s, sharing that host
     * with three other jobs from this pipeline. The same commits passed on three
     * other runners in 289-596s, and a later job passed on the same host in 674s
     * once it had the host to itself. Aggregate phase time for identical work
     * (679 files) inflated from 3675s to 20062s, which is contention and not
     * extra work. The tell in a log is `[vitest-pool]: Worker forks emitted
     * error` or `Timeout starting forks runner` under a pile of 20s timeouts.
     *
     * Six is a measured trade. Locally on 12 cpus, CI=1 and --coverage, run
     * back to back:
     *
     *     cap 11 (today)  138.6s   9.8 workers   1353 worker-seconds
     *     cap 8           142.3s   7.0 workers    999
     *     cap 6           235.6s   5.2 workers   1224
     *     cap 4           307.0s   3.6 workers   1117
     *
     * Treat those wall times as a shape and not as constants. A later run of
     * this exact config came back at 157.7s with the same 5.2 workers, so the
     * worker-seconds column carries about 25% of whatever else the machine was
     * doing. The ordering is solid, the ratios are not: cap 6 costs somewhere
     * between 15% and 70% of wall time, not a number worth quoting to two
     * digits. Re-measure back to back on an idle machine before moving this.
     *
     * Total work is near constant and wall time is just that over the worker
     * count, so a cap does not save work, it lowers the thrash a shared host
     * pays. Scaled to CI, where the vitest phase is ~382s at ~9.7 workers, six
     * puts it near 617s and four near 926s. Under real four-way contention
     * every setting converges around 1350s anyway, because the total work is
     * fixed and the cpus are not; the observed 2270s was roughly 40% thrash on
     * top of that floor, and this is what removes it. Six keeps the common case
     * from doubling while cutting the pile-up nearly in half.
     *
     * CI only. Nothing competes with the suite on a developer machine, so there
     * the full pool is free speed and this would only slow it down.
     *
     * This is `maxWorkers` and not `poolOptions.forks.maxForks`: vitest 4
     * dropped poolOptions, and the old spelling fails `tsc --noEmit` with
     * "'poolOptions' does not exist in type 'InlineConfig'", which the test
     * suite itself would not have caught.
     */
    maxWorkers: process.env.CI ? 6 : undefined,
    coverage: {
      provider: 'v8',
      // `include` is what makes a file with no test at all count as 0% rather
      // than be absent from the report, which is the difference between "how
      // well tested is the code" and "how well tested is the code we wrote
      // tests for". Vitest 3 spelled this `coverage.all`; that option is gone
      // in 4 and every file matching `include` is measured either way.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        // Generated from veodyn-api's openapi.json by `pnpm gen:api-types`.
        'src/types/generated/**',
        // The harness itself, and the fixture packs it pins.
        'src/test/**',
        'src/lib/mock-data/**',
        // Test-support modules that do not end in .test.ts, so `include` would
        // otherwise count them as product code. Each was checked: their only
        // importers are test files and each other, never src. They sit near
        // 100% by construction, which inflates the total with code no user runs.
        'src/**/*-fixtures.ts',
        'src/**/*-test-harness.ts',
      ],
      // text-summary for the job log, cobertura for GitLab's coverage_report.
      reporter: ['text-summary', 'text', 'cobertura'],
      reportsDirectory: './coverage',
    },
    // The pack this suite runs against. packs/active.ts (the fallback tsc and
    // Vitest resolve, since neither reads next.config.ts) can only ever
    // resolve neutral now: packs/la carried real customer hostnames and org
    // names and moved out to a private tenant pack repo, so it does not exist
    // in this checkout for any env value to select. Pin it to neutral anyway
    // so the pack this suite exercises is stated, not incidental.
    env: { NEXT_PUBLIC_DEMO_PACK: 'neutral' },
    /**
     * Let a repeated message through a few times, then stop printing it.
     *
     * This exists because a flooded log is not a cosmetic problem: it destroys
     * the failure report. Vitest prints which assertions failed at the END of
     * the run, and GitLab stops collecting a job's log at 4 MB. On 2026-07-30
     * one CI run emitted 5265 React act(...) warnings across 30-odd components,
     * blew the limit mid-run, and took the failure summary with it. Finding the
     * one test that actually failed meant hunting a single `x` character 54000
     * lines into the trace.
     *
     * Suppressing the 5265th copy of a message loses nothing: the first few say
     * everything the hundredth does. The budget is per shape, so a NEW kind of
     * warning still gets printed even after another kind has been silenced.
     *
     * Why the warnings are not simply fixed instead: they are diffuse across
     * more than thirty components (411 from FavoritesControl, 390 from
     * QueryEditorPage, 333 from QueryRowActions, and a long tail), so there is
     * no small fix, and they do not reproduce on a fast machine, so a sweep
     * chasing them could not be verified by whoever wrote it.
     *
     * HONEST LIMIT: this hook is unverified. No local invocation of vitest
     * (piped, through a pty, or with CI=true) surfaces test console output at
     * all, so there is no way to observe the suppression working from here. It
     * is safe either way, since the worst case is that it does nothing, and the
     * junit artifact added in ci/veodyn-de-test.yaml is what actually
     * guarantees a readable failure report. Confirm this one from a CI log.
     */
    onConsoleLog(log) {
      const shape = shapeOf(log)
      const count = (seenShapes.get(shape) ?? 0) + 1
      seenShapes.set(shape, count)
      // A new shape always gets through, so silencing one class of message
      // never hides a different one that appears later.
      return count <= REPEAT_BUDGET ? undefined : false
    },
  },
})
