import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { PivotEditor } from './pivot-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'region', friendly_name: 'Region', type: 'string' },
  { name: 'quarter', friendly_name: 'Quarter', type: 'string' },
  { name: 'revenue', friendly_name: 'Revenue', type: 'float' },
]

// Keeps the editor's options controlled so a real column selection is
// reflected before the select is reopened, like the actual edit dialog does.
function ControlledPivotEditor({ onChange }: { onChange: (options: Record<string, unknown>) => void }) {
  const [options, setOptions] = useState<Record<string, unknown>>({})
  return (
    <PivotEditor
      options={options}
      columns={columns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

describe('PivotEditor reset options', () => {
  it('lets the Row Field select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledPivotEditor onChange={onChange} />)

    const [rowFieldTrigger] = screen.getAllByRole('combobox')
    await user.click(rowFieldTrigger)
    await user.click(await screen.findByRole('option', { name: 'region' }))
    expect(onChange).toHaveBeenLastCalledWith({ rowField: 'region' })

    // Reopen and click the reset option that carries the field's original
    // empty-option label. Before the fix this option did not exist.
    await user.click(rowFieldTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ rowField: '' })
  })

  it('lets the Column Field select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledPivotEditor onChange={onChange} />)

    const [, colFieldTrigger] = screen.getAllByRole('combobox')
    await user.click(colFieldTrigger)
    await user.click(await screen.findByRole('option', { name: 'quarter' }))
    expect(onChange).toHaveBeenLastCalledWith({ colField: 'quarter' })

    await user.click(colFieldTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ colField: '' })
  })

  it('lets the Value Field select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledPivotEditor onChange={onChange} />)

    const [, , valueFieldTrigger] = screen.getAllByRole('combobox')
    await user.click(valueFieldTrigger)
    await user.click(await screen.findByRole('option', { name: 'revenue' }))
    expect(onChange).toHaveBeenLastCalledWith({ valueField: 'revenue' })

    await user.click(valueFieldTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ valueField: '' })
  })
})
