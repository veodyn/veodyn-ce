import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { CounterEditor } from './counter-editor'
import type { QueryResultColumn } from '@/lib/mock-data'

afterEach(() => resetStores())

const columns: QueryResultColumn[] = [
  { name: 'revenue', friendly_name: 'Revenue', type: 'float' },
  { name: 'orders', friendly_name: 'Orders', type: 'integer' },
]

// Keeps the editor's options controlled so a real column selection is
// reflected before the select is reopened, like the actual edit dialog does.
function ControlledCounterEditor({ onChange }: { onChange: (options: Record<string, unknown>) => void }) {
  const [options, setOptions] = useState<Record<string, unknown>>({})
  return (
    <CounterEditor
      options={options}
      columns={columns}
      onChange={(next) => {
        onChange(next)
        setOptions(next)
      }}
    />
  )
}

describe('CounterEditor reset options', () => {
  it('lets the Counter Column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledCounterEditor onChange={onChange} />)

    const [counterColumnTrigger] = screen.getAllByRole('combobox')
    await user.click(counterColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'revenue' }))
    expect(onChange).toHaveBeenLastCalledWith({ counterColName: 'revenue' })

    // Reopen and click the reset option that carries the field's original
    // empty-option label. Before the fix this option did not exist.
    await user.click(counterColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'First column' }))
    expect(onChange).toHaveBeenLastCalledWith({ counterColName: '' })
  })

  it('lets the Target Column select be cleared back to unset after picking a real column', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    renderWithProviders(<ControlledCounterEditor onChange={onChange} />)

    const [, targetColumnTrigger] = screen.getAllByRole('combobox')
    await user.click(targetColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'orders' }))
    expect(onChange).toHaveBeenLastCalledWith({ targetColName: 'orders' })

    await user.click(targetColumnTrigger)
    await user.click(await screen.findByRole('option', { name: 'No target' }))
    expect(onChange).toHaveBeenLastCalledWith({ targetColName: undefined })
  })
})
