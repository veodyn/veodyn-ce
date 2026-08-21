import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ChoroplethEditor } from './choropleth-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'district', friendly_name: 'District', type: 'string' },
  { name: 'trips', friendly_name: 'Trips', type: 'integer' },
  { name: 'boundary', friendly_name: 'Boundary', type: 'string' },
]

function ControlledChoroplethEditor({
  initial = {},
  onChange = vi.fn(),
}: {
  initial?: Record<string, unknown>
  onChange?: (options: Record<string, unknown>) => void
}) {
  const [options, setOptions] = useState<Record<string, unknown>>(initial)
  return (
    <ChoroplethEditor
      options={options}
      columns={columns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

const MAP_OPTIONS = { keyColumn: 'district', valueColumn: 'trips', targetField: 'name', mapType: 'world-countries' }

describe('ChoroplethEditor boundary source', () => {
  it('opens on the bundled map when nothing is saved, so an old choropleth is unchanged', () => {
    renderWithProviders(<ControlledChoroplethEditor initial={MAP_OPTIONS} />)

    expect(screen.getByRole('radio', { name: /bundled map/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /geometry column/i })).not.toBeChecked()
    expect(screen.getByText(/matched against/i)).toBeInTheDocument()
    expect(screen.getByText(/^map type$/i)).toBeInTheDocument()
    expect(screen.queryByText(/geometry column \(geojson\)/i)).not.toBeInTheDocument()
  })

  it('writes boundarySource without dropping the options already set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledChoroplethEditor initial={MAP_OPTIONS} onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: /geometry column/i }))

    expect(onChange).toHaveBeenLastCalledWith({ ...MAP_OPTIONS, boundarySource: 'column' })
  })

  // targetField and mapType are read by nothing in this mode, so offering them
  // would invite an analyst to configure a join that is not happening.
  it('hides the bundled-map controls and offers a geometry column instead', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ControlledChoroplethEditor initial={MAP_OPTIONS} />)
    await user.click(screen.getByRole('radio', { name: /geometry column/i }))

    expect(screen.queryByText(/matched against/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/^map type$/i)).not.toBeInTheDocument()
    expect(screen.getByText(/geometry column \(geojson\)/i)).toBeInTheDocument()
    // Key and value stay: they still label and shade each region.
    expect(screen.getByText(/key column/i)).toBeInTheDocument()
    expect(screen.getByText(/value column/i)).toBeInTheDocument()
  })

  it('lists the result columns in the geometry picker', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ControlledChoroplethEditor initial={{ ...MAP_OPTIONS, boundarySource: 'column' }} />)

    // Key column, value column, geometry column: the geometry picker is last.
    await user.click(screen.getAllByRole('combobox')[2])

    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(labels).toEqual(['Select column...', 'district', 'trips', 'boundary'])
  })

  it('writes geometryColumn without dropping the options already set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledChoroplethEditor
        initial={{ boundarySource: 'column', keyColumn: 'district', valueColumn: 'trips' }}
        onChange={onChange}
      />
    )

    await user.click(screen.getAllByRole('combobox')[2])
    await user.click(await screen.findByRole('option', { name: 'boundary' }))

    expect(onChange).toHaveBeenLastCalledWith({
      boundarySource: 'column',
      keyColumn: 'district',
      valueColumn: 'trips',
      geometryColumn: 'boundary',
    })
  })

  it('warns while no geometry column is picked and stops once one is', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ControlledChoroplethEditor initial={{ boundarySource: 'column', keyColumn: 'district', valueColumn: 'trips' }} />
    )

    expect(screen.getByText(/nothing can be drawn/i)).toBeInTheDocument()

    await user.click(screen.getAllByRole('combobox')[2])
    await user.click(await screen.findByRole('option', { name: 'boundary' }))

    expect(screen.queryByText(/nothing can be drawn/i)).not.toBeInTheDocument()
  })

  // The option is dropped, not merely ignored: left behind, it names a column
  // that map mode never reads, and the missing-column check would report it
  // above a map that is drawing perfectly well.
  it('goes back to the bundled map, clearing the geometry column and restoring its controls', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledChoroplethEditor
        initial={{ ...MAP_OPTIONS, boundarySource: 'column', geometryColumn: 'boundary' }}
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('radio', { name: /bundled map/i }))

    expect(onChange).toHaveBeenLastCalledWith({ ...MAP_OPTIONS, boundarySource: 'map' })
    expect(onChange.mock.lastCall?.[0]).not.toHaveProperty('geometryColumn')
    expect(screen.getByText(/matched against/i)).toBeInTheDocument()
    expect(screen.getByText(/^map type$/i)).toBeInTheDocument()
  })

  // Switching the other way keeps mapType and targetField: neither names a
  // result column, so neither can go stale, and keeping them makes the toggle
  // non-destructive in the direction an analyst is most likely to undo.
  it('keeps the bundled-map options when switching to the geometry column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledChoroplethEditor initial={MAP_OPTIONS} onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: /geometry column/i }))

    expect(onChange).toHaveBeenLastCalledWith({ ...MAP_OPTIONS, boundarySource: 'column' })
  })
})
