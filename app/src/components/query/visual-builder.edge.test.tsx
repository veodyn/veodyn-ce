// The states a field picker actually reaches: nothing picked, filters without a
// select list, the last field removed, a dataset with no schema, and a spec the
// compiler refuses. compileVisualQuery throws on a refused identifier or a
// cross-dataset spec, so every one of those has to land as a readable message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import {
  chooseOption,
  composedSql,
  restoreDatasets,
  seedDatasets,
} from './visual-builder-test-fixtures'
import { VisualBuilder } from './visual-builder'

describe('VisualBuilder edge cases', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  function renderBuilder(datasetId = 'trips-daily') {
    const onCompile = vi.fn()
    const onSwitchToPro = vi.fn()
    renderWithProviders(
      <VisualBuilder datasetId={datasetId} onCompile={onCompile} onSwitchToPro={onSwitchToPro} />
    )
    return { onCompile, onSwitchToPro }
  }

  it('runs an empty spec as a plain select', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    const run = await screen.findByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()
    await user.click(run)

    expect(onCompile).toHaveBeenCalledWith('SELECT *\nFROM trips_daily\nLIMIT 100', {
      type: 'TABLE',
      name: 'Table',
      options: {},
    })
  })

  it('compiles a spec that carries only filters', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'trips')
    await chooseOption(user, 'Filter 1 operator', '>')
    await user.type(screen.getByLabelText('Filter 1 value'), '10')

    expect(await composedSql(user, onCompile)).toBe('SELECT *\nFROM trips_daily\nWHERE trips > 10\nLIMIT 100')
  })

  // Only reachable because the builder hands the dataset schema to the compiler
  // as its allowlist: without the column types a payload on a numeric column
  // would be quoted into the SQL instead of refused.
  it('refuses a non-numeric value on a numeric column', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'trips')
    await user.type(screen.getByLabelText('Filter 1 value'), '1 OR 1=1')

    expect(screen.getByRole('alert')).toHaveTextContent(/needs a numeric value/i)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(await composedSql(user, onCompile)).toBe('')
  })

  it('falls back to a plain select when the last dimension is removed', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    const line = await screen.findByRole('button', { name: 'line' })
    await user.click(line)
    expect(await composedSql(user, onCompile)).toContain('SELECT line')

    await user.click(screen.getByRole('button', { name: 'line' }))
    expect(screen.getByRole('button', { name: 'line' })).toHaveAttribute('aria-pressed', 'false')
    expect(await composedSql(user, onCompile)).toBe('SELECT *\nFROM trips_daily\nLIMIT 100')
  })

  it('keeps a filter on a column that leaves the select list', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'line' }))
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'line')
    await user.type(screen.getByLabelText('Filter 1 value'), 'Red')
    expect(await composedSql(user, onCompile)).toBe(
      "SELECT line\nFROM trips_daily\nWHERE line = 'Red'\nLIMIT 100"
    )

    await user.click(screen.getByRole('button', { name: 'line' }))
    expect(await composedSql(user, onCompile)).toBe("SELECT *\nFROM trips_daily\nWHERE line = 'Red'\nLIMIT 100")
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains a dataset with no column metadata instead of offering empty pickers', async () => {
    renderBuilder('bare-daily')

    expect(await screen.findByText(/no column metadata/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add measure' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Open in SQL Editor' })).toBeEnabled()
  })

  it('prompts to continue in PRO when a field spans another dataset', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder('joined-daily')

    await user.click(await screen.findByRole('button', { name: 'weather_daily.condition' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/cross-dataset join/i)
    expect(alert).toHaveTextContent(/continue in the SQL editor/i)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(await composedSql(user, onCompile)).toBe('')
  })

  it('surfaces a refused sort column as a readable validation message', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add measure' }))
    await user.click(screen.getByRole('button', { name: 'Add sort' }))
    await chooseOption(user, 'Sort 1 column', 'sum_trips')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // The alias the sort points at leaves the SELECT list with its measure row.
    await user.click(screen.getByRole('button', { name: 'Remove measure 1' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/sort column "sum_trips"/i)
    expect(alert.textContent ?? '').not.toMatch(/E_API_|AppError|\bat\s+\w+\s*\(/)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(await composedSql(user, onCompile)).toBe('')
  })

  it('surfaces a dataset slug that cannot be a SQL identifier', async () => {
    renderBuilder('9-bad-slug')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/unsafe SQL identifier/i)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
  })
})
