import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FunnelEditor } from './funnel-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'stage', friendly_name: 'Stage', type: 'string' },
  { name: 'count', friendly_name: 'Count', type: 'integer' },
]

// Keeps the editor's options controlled so a real column selection is
// reflected before the select is reopened, like the actual edit dialog does.
function ControlledFunnelEditor({ onChange }: { onChange: (options: Record<string, unknown>) => void }) {
  const [options, setOptions] = useState<Record<string, unknown>>({})
  return (
    <FunnelEditor
      options={options}
      columns={columns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

describe('FunnelEditor reset options', () => {
  it('lets the Step Column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledFunnelEditor onChange={onChange} />)

    const [stepColumnTrigger] = screen.getAllByRole('combobox')
    await user.click(stepColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'stage' }))
    expect(onChange).toHaveBeenLastCalledWith({ stepColumn: 'stage' })

    // Reopen and click the reset option that carries the field's original
    // empty-option label. Before the fix this option did not exist.
    await user.click(stepColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ stepColumn: '' })
  })

  it('lets the Value Column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledFunnelEditor onChange={onChange} />)

    const [, valueColumnTrigger] = screen.getAllByRole('combobox')
    await user.click(valueColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'count' }))
    expect(onChange).toHaveBeenLastCalledWith({ valueColumn: 'count' })

    await user.click(valueColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'Select column...' }))
    expect(onChange).toHaveBeenLastCalledWith({ valueColumn: '' })
  })
})
