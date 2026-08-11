import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ChoroplethEditor } from './choropleth-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'country', friendly_name: 'Country', type: 'string' },
  { name: 'revenue', friendly_name: 'Revenue', type: 'float' },
]

// Keeps the editor's options controlled so a real column selection is
// reflected before the select is reopened, like the actual edit dialog does.
function ControlledChoroplethEditor({
  initial = {},
  onChange,
}: {
  initial?: Record<string, unknown>
  onChange: (options: Record<string, unknown>) => void
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

// The controls read in join order: key column, the geometry property it is
// matched against, value column, map type.
const KEY = 0
const TARGET = 1
const VALUE = 2
const MAP_TYPE = 3

describe('ChoroplethEditor', () => {
  it('shows the saved options on the triggers', () => {
    renderWithProviders(
      <ControlledChoroplethEditor
        initial={{
          keyColumn: 'country',
          targetField: 'iso_a2',
          valueColumn: 'revenue',
          mapType: 'world-countries',
        }}
        onChange={vi.fn()}
      />
    )

    const triggers = screen.getAllByRole('combobox')
    expect(triggers[KEY]).toHaveTextContent('country')
    expect(triggers[TARGET]).toHaveTextContent('iso_a2')
    expect(triggers[VALUE]).toHaveTextContent('revenue')
    expect(triggers[MAP_TYPE]).toHaveTextContent('World Countries')
  })

  // The option names are Redash's own (RedashChoroplethOptions), and the
  // renderer and choropleth-model read those exact keys, so a saved
  // choropleth renders in both places. Asserting the whole object rather than
  // objectContaining is what makes a wrong key (keyColName, valueColName)
  // fail here instead of silently producing a map that never joins.
  it('writes keyColumn without dropping the options already set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledChoroplethEditor initial={{ valueColumn: 'revenue' }} onChange={onChange} />
    )

    await user.click(screen.getAllByRole('combobox')[KEY])
    await user.click(await screen.findByRole('option', { name: 'country' }))

    expect(onChange).toHaveBeenLastCalledWith({ valueColumn: 'revenue', keyColumn: 'country' })
  })

  it('writes valueColumn without dropping the options already set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledChoroplethEditor initial={{ keyColumn: 'country' }} onChange={onChange} />
    )

    await user.click(screen.getAllByRole('combobox')[VALUE])
    await user.click(await screen.findByRole('option', { name: 'revenue' }))

    expect(onChange).toHaveBeenLastCalledWith({ keyColumn: 'country', valueColumn: 'revenue' })
  })

  // targetField is the other half of the join: buildChoroplethModel reads
  // feature.properties[targetField], so writing any other key leaves every
  // region unmatched no matter how good the key column is.
  it('writes targetField without dropping the options already set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledChoroplethEditor
        initial={{ keyColumn: 'country', valueColumn: 'revenue' }}
        onChange={onChange}
      />
    )

    await user.click(screen.getAllByRole('combobox')[TARGET])
    await user.click(await screen.findByRole('option', { name: 'iso_a3' }))

    expect(onChange).toHaveBeenLastCalledWith({
      keyColumn: 'country',
      valueColumn: 'revenue',
      targetField: 'iso_a3',
    })
  })

  // The list is the property keys world-countries.geojson actually carries.
  // Offering a fourth would let a user pick a property no feature has, which
  // fails exactly like leaving it unset.
  it('offers only the properties the shipped geometry carries', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ControlledChoroplethEditor onChange={vi.fn()} />)

    await user.click(screen.getAllByRole('combobox')[TARGET])

    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(labels).toEqual(['name', 'iso_a2', 'iso_a3'])
  })

  // The renderer blames the key column for an unset targetField, so the
  // warning has to name the real culprit here, before the map is drawn.
  it('warns while no map property is picked and stops once one is', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ControlledChoroplethEditor
        initial={{ keyColumn: 'country', valueColumn: 'revenue' }}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText(/nothing can match and the map draws empty/i)).toBeInTheDocument()

    await user.click(screen.getAllByRole('combobox')[TARGET])
    await user.click(await screen.findByRole('option', { name: 'name' }))

    expect(screen.queryByText(/nothing can match and the map draws empty/i)).not.toBeInTheDocument()
  })

  it('lets a column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledChoroplethEditor onChange={onChange} />)

    const keyTrigger = screen.getAllByRole('combobox')[KEY]
    await user.click(keyTrigger)
    await user.click(await screen.findByRole('option', { name: 'country' }))
    expect(onChange).toHaveBeenLastCalledWith({ keyColumn: 'country' })

    await user.click(keyTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ keyColumn: '' })
  })

  // Only the map types with a /geo/<mapType>.geojson asset may be offered: a
  // value with no asset makes useVizGeoJson 404 and the renderer degrades to
  // "Map geometry is unavailable in this context."
  it('offers only the map types the app ships geometry for', async () => {
    const user = userEvent.setup()

    renderWithProviders(<ControlledChoroplethEditor onChange={vi.fn()} />)

    await user.click(screen.getAllByRole('combobox')[MAP_TYPE])

    const labels = (await screen.findAllByRole('option')).map((o) => o.textContent)
    expect(labels).toEqual(['World Countries'])
  })

  // A choropleth authored in stock Redash carries its default mapType of
  // "countries", which this app has no asset for. Picking the supported map
  // has to repair it under the same key the renderer reads.
  it('writes mapType when an unsupported saved value is replaced', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(
      <ControlledChoroplethEditor
        initial={{
          keyColumn: 'country',
          targetField: 'name',
          valueColumn: 'revenue',
          mapType: 'countries',
        }}
        onChange={onChange}
      />
    )

    await user.click(screen.getAllByRole('combobox')[MAP_TYPE])
    await user.click(await screen.findByRole('option', { name: 'World Countries' }))

    expect(onChange).toHaveBeenLastCalledWith({
      keyColumn: 'country',
      targetField: 'name',
      valueColumn: 'revenue',
      mapType: 'world-countries',
    })
  })
})
