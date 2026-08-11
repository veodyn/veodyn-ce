// A filter on a date column. `captured_at >= 2026` used to compile into
// perfectly valid SQL that ClickHouse then refused:
//
//   Code: 41. DB::Exception: Cannot parse DateTime: while converting '2026' to
//   DateTime64(3, 'UTC'). (CANNOT_PARSE_DATETIME)
//
// The value was quoted as an ordinary string literal, because only numeric
// columns had a rule about what belongs in them.
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

describe('a filter on a date column', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  function renderBuilder() {
    const onCompile = vi.fn()
    renderWithProviders(
      <VisualBuilder datasetId="trips-daily" onCompile={onCompile} onSwitchToPro={vi.fn()} />
    )
    return { onCompile }
  }

  it('offers a date control rather than a box that takes anything', async () => {
    const user = userEvent.setup()
    renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'service_date')

    expect(screen.getByLabelText('Filter 1 value')).toHaveAttribute('type', 'date')
  })

  it('goes back to a plain box on a column that is not a date', async () => {
    const user = userEvent.setup()
    renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'line')

    expect(screen.getByLabelText('Filter 1 value')).toHaveAttribute('type', 'text')
  })

  it('compiles a date into a quoted literal', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'service_date')
    await chooseOption(user, 'Filter 1 operator', '>=')
    await user.type(screen.getByLabelText('Filter 1 value'), '2026-07-22')

    expect(await composedSql(user, onCompile)).toBe(
      "SELECT *\nFROM trips_daily\nWHERE service_date >= '2026-07-22'\nLIMIT 100"
    )
  })
})
