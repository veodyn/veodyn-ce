// Shared fixtures and interaction helpers for the VisualBuilder suites. Not a
// test file itself (the name deliberately avoids the `.test.` pattern vitest
// collects), just the setup the three VisualBuilder suites need.
import { screen } from '@testing-library/react'
import type userEvent from '@testing-library/user-event'
import { mockDatasets, type MockDataSource } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { Dataset } from '@/types/catalog'

type User = ReturnType<typeof userEvent.setup>

function fixture(id: string, name: string, schema: Dataset['schema']): Dataset {
  return {
    id,
    name,
    description: `${name} fixture`,
    domain: null,
    schema,
    freshness: { lastUpdatedAt: '2026-07-22T06:00:00Z', status: 'fresh' },
    coverage: { start: '2026-01-01T00:00:00Z', end: '2026-07-22T00:00:00Z' },
    rowCount: 1000,
    sources: ['Fixture'],
    tags: [],
    sampleQueryId: null,
  }
}

// Two non-numeric columns (dimensions) and two numeric ones (measures).
export const TRIPS = fixture('trips-daily', 'Trips Daily', [
  { name: 'service_date', type: 'date' },
  { name: 'line', type: 'string' },
  { name: 'trips', type: 'integer' },
  { name: 'avg_delay', type: 'float' },
])
export const TRIPS_TABLE = 'trips_daily'

// A catalog column that names another dataset. Picking it makes the spec a
// cross-dataset join, which the Visual subset refuses by design.
export const JOINED = fixture('joined-daily', 'Joined Daily', [
  { name: 'line', type: 'string' },
  { name: 'weather_daily.condition', type: 'string' },
  { name: 'trips', type: 'integer' },
])

// Catalogued but with no column metadata: there is nothing to pick.
export const NO_COLUMNS = fixture('bare-daily', 'Bare Daily', [])

// A slug that cannot become a SQL identifier, so the compiler refuses it.
export const BAD_SLUG = fixture('9-bad-slug', 'Nine Bad Slug', [
  { name: 'line', type: 'string' },
])

export function seedDatasets() {
  useMockDataStore.setState({ datasets: [TRIPS, JOINED, NO_COLUMNS, BAD_SLUG] })
}

export function restoreDatasets() {
  useMockDataStore.setState({ datasets: [...mockDatasets] })
}

// A data source that takes SQL, or one that takes something else. Which of the
// two a query is aimed at decides whether Run works at all, so both targeting
// suites build their instances from here rather than from the mock pack, whose
// ids happen to be in a friendly order.
export function sqlSource(id: number, name: string): MockDataSource {
  return {
    id,
    name,
    type: 'clickhouse',
    syntax: 'sql',
    paused: 0,
    pause_reason: null,
    options: {},
    groups: {},
    created_at: '2026-01-01T00:00:00Z',
    view_only: false,
  }
}

export function jsonSource(id: number, name: string): MockDataSource {
  return { ...sqlSource(id, name), type: 'metrocloudalliance', syntax: 'json' }
}

// The base-ui Select renders its options into a portal and only while open, so
// every choice is a trigger click followed by an option click.
export async function chooseOption(user: User, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

// The visualization picker is a radio group of tiles, so a choice is one click
// on the tile that reads as its label.
export async function chooseViz(user: User, label: string) {
  await user.click(screen.getByRole('radio', { name: label }))
}

/**
 * The SQL the builder has published for the page's PRO tab, or '' if it has
 * published none.
 *
 * The other window onto the composition, and the one to use when clicking Run
 * would disturb what the test is counting: this is a prop the builder writes on
 * every change, so reading it costs no interaction. Note it holds the last SQL
 * that *did* compile, so unlike `composedSql` it does not go back to '' when the
 * current picks stop compiling.
 */
export function publishedSql(onCompiledSqlChange: { mock: { calls: unknown[][] } }): string {
  const calls = onCompiledSqlChange.mock.calls
  return (calls.at(-1)?.[0] as string | null | undefined) ?? ''
}

/**
 * The SQL the builder would run, or '' when the current fields do not compile.
 *
 * Read from what Run hands over rather than from a preview, because the builder
 * no longer shows its SQL: the composed query is the output, and Run is where it
 * leaves. Run is disabled in exactly the cases the old preview replaced with a
 * reason, which is why a disabled Run answers '' here.
 */
export async function composedSql(
  user: User,
  onCompile: { mock: { calls: unknown[][] } }
): Promise<string> {
  const run = screen.getByRole('button', { name: 'Run' })
  if ((run as HTMLButtonElement).disabled) return ''
  await user.click(run)
  return (onCompile.mock.calls.at(-1)?.[0] as string | undefined) ?? ''
}

// Every button's accessible name, for asserting an affordance is absent.
export function buttonNames(): string[] {
  return screen
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
}
