import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { MapEditor } from './map-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'lat', friendly_name: 'Latitude', type: 'float' },
  { name: 'lon', friendly_name: 'Longitude', type: 'float' },
  { name: 'place', friendly_name: 'Place', type: 'string' },
]

// Keeps the editor's options controlled so a real column selection is
// reflected before the select is reopened, like the actual edit dialog does.
function ControlledMapEditor({ onChange }: { onChange: (options: Record<string, unknown>) => void }) {
  const [options, setOptions] = useState<Record<string, unknown>>({})
  return (
    <MapEditor
      options={options}
      columns={columns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

describe('MapEditor reset options', () => {
  it('lets the Latitude Column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledMapEditor onChange={onChange} />)

    const [latTrigger] = screen.getAllByRole('combobox')
    await user.click(latTrigger)
    await user.click(await screen.findByRole('option', { name: 'lat' }))
    expect(onChange).toHaveBeenLastCalledWith({ latColName: 'lat' })

    // Reopen and click the reset option that carries the field's original
    // empty-option label. Before the fix this option did not exist.
    await user.click(latTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ latColName: '' })
  })

  it('lets the Longitude Column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledMapEditor onChange={onChange} />)

    const [, lonTrigger] = screen.getAllByRole('combobox')
    await user.click(lonTrigger)
    await user.click(await screen.findByRole('option', { name: 'lon' }))
    expect(onChange).toHaveBeenLastCalledWith({ lonColName: 'lon' })

    await user.click(lonTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ lonColName: '' })
  })

  it('lets the Group By select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledMapEditor onChange={onChange} />)

    const [, , classifyTrigger] = screen.getAllByRole('combobox')
    await user.click(classifyTrigger)
    await user.click(await screen.findByRole('option', { name: 'place' }))
    expect(onChange).toHaveBeenLastCalledWith({ classify: 'place' })

    await user.click(classifyTrigger)
    await user.click(await screen.findByRole('option', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith({ classify: undefined })
  })

  // The option names are Redash's own (viz-lib map/getOptions), so a map saved
  // in Redash renders here and one saved here renders there.
  it('writes the popup template Redash reads', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledMapEditor onChange={onChange} />)

    // paste, not type: userEvent reads `{{` in typed text as an escaped brace.
    await user.click(screen.getByRole('textbox'))
    await user.paste('{{ place }}')

    expect(onChange).toHaveBeenLastCalledWith({
      popup: { enabled: true, template: '{{ place }}' },
    })
  })
})
