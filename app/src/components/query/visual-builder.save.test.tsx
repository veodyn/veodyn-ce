// Keeping what the builder composed. The editor's own Save acts on the PRO
// buffer and is unmounted in Visual mode, so until this button existed a query
// assembled here could only be run, never kept.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { restoreDatasets, seedDatasets } from './visual-builder-test-fixtures'
import { VisualBuilder } from './visual-builder'
import type { VisualBuilderProps } from './visual-builder'

const TRIPS_SQL = 'SELECT *\nFROM trips_daily\nLIMIT 100'

describe('VisualBuilder Save', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  function renderBuilder(overrides: Partial<VisualBuilderProps> = {}) {
    const onSave = vi.fn()
    renderWithProviders(
      <VisualBuilder
        datasetId="trips-daily"
        onCompile={vi.fn()}
        onSwitchToPro={vi.fn()}
        onSave={onSave}
        {...overrides}
      />
    )
    return { onSave }
  }

  it('saves the composed SQL, not whatever the caller last held', async () => {
    const user = userEvent.setup()
    const { onSave } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(TRIPS_SQL)
  })

  it('saves the picks as they stand, including one made after the last Run', async () => {
    const user = userEvent.setup()
    const { onSave } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'service_date' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith('SELECT service_date\nFROM trips_daily\nLIMIT 100')
  })

  it('is off while the picks do not compile, so nothing half-composed is kept', async () => {
    // A cross-dataset join: the one shape the Visual subset refuses outright.
    renderBuilder({ datasetId: 'joined-daily' })

    const save = await screen.findByRole('button', { name: 'Save' })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'weather_daily.condition' }))

    expect(save).toBeDisabled()
  })

  it('stays on when Run is off, because saving is not running', async () => {
    // A data source that takes some other query language blocks Run. The query
    // is still worth keeping: PRO has always let one be saved against a source
    // that cannot answer it.
    const user = userEvent.setup()
    const { onSave } = renderBuilder({ runBlockedReason: 'Regional Waze takes json, not SQL.' })

    expect(await screen.findByRole('button', { name: 'Run' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith(TRIPS_SQL)
  })

  it('reports the save in flight rather than taking a second click', async () => {
    renderBuilder({ isSaving: true })

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('is not mounted at all with nowhere to save to', async () => {
    renderBuilder({ onSave: undefined })

    // The standalone builder still composes and still offers the way out to
    // PRO; it is only the keeping that needs a caller.
    expect(await screen.findByRole('button', { name: 'Open in SQL Editor' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})
