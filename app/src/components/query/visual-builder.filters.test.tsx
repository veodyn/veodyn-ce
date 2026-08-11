// A filter row is added empty, so the picker has to tell "not filled in yet"
// apart from "wrong". It used to treat both as wrong: adding a row on a numeric
// column raised 'The filter on "trips" needs a numeric value' under an empty
// box and switched Run off before anything had been typed.
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

const TRIPS_SQL = 'SELECT *\nFROM trips_daily\nLIMIT 100'

describe('a filter that has not been filled in', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  function renderBuilder() {
    const onCompile = vi.fn()
    renderWithProviders(
      <VisualBuilder datasetId="trips-daily" onCompile={onCompile} onSwitchToPro={vi.fn()} />
    )
    return { onCompile }
  }

  it('leaves the query runnable instead of erroring on an empty box', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'trips')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
    // Nothing in the WHERE clause, because the row does not say anything yet.
    expect(await composedSql(user, onCompile)).toBe(TRIPS_SQL)
  })

  it('says so on the row, so a filter left blank is not silently dropped', async () => {
    const user = userEvent.setup()
    renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'trips')

    const value = screen.getByLabelText('Filter 1 value')
    expect(screen.getByText('Add a value to apply this filter.')).toBeInTheDocument()
    expect(value).toHaveAccessibleDescription('Add a value to apply this filter.')

    await user.type(value, '10')

    expect(screen.queryByText('Add a value to apply this filter.')).not.toBeInTheDocument()
  })

  it('counts a value of nothing but spaces as unfinished too', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'line')
    await user.type(screen.getByLabelText('Filter 1 value'), '   ')

    expect(screen.getByText('Add a value to apply this filter.')).toBeInTheDocument()
    expect(await composedSql(user, onCompile)).toBe(TRIPS_SQL)
  })

  it('still refuses a value that was actually typed and is wrong for the column', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'trips')
    await user.type(screen.getByLabelText('Filter 1 value'), '1 OR 1=1')

    expect(screen.getByRole('alert')).toHaveTextContent(/needs a numeric value/i)
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled()
    expect(await composedSql(user, onCompile)).toBe('')
  })

  it('drops only the unfinished row, keeping the ones that are complete', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'line')
    await user.type(screen.getByLabelText('Filter 1 value'), 'Red')
    await user.click(screen.getByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 2 column', 'trips')

    expect(await composedSql(user, onCompile)).toBe(
      "SELECT *\nFROM trips_daily\nWHERE line = 'Red'\nLIMIT 100"
    )
  })
})
