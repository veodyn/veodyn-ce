/**
 * The bar is used in two places with different jobs. On a query or dashboard it
 * only runs things, so it offers values and nothing else. In the editor it is
 * also where a parameter gets configured, so it offers a way in to the settings.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockQueryParameter } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'
import { ParametersBar } from './parameters-bar'

const PARAMS: MockQueryParameter[] = [
  { name: 'route_id', title: 'Route', type: 'text', value: '12' },
  { name: 'day', title: 'Day', type: 'date', value: '' },
]

describe('editing parameters from the bar', () => {
  it('offers no settings control where the bar only runs things', () => {
    renderWithProviders(<ParametersBar parameters={PARAMS} onChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /settings/i })).not.toBeInTheDocument()
  })

  it('offers one settings control per parameter when editing is possible', () => {
    renderWithProviders(
      <ParametersBar parameters={PARAMS} onChange={vi.fn()} onEditParameter={vi.fn()} />
    )

    // Named per parameter rather than a row of identical "Settings" buttons,
    // which read the same to a screen reader.
    expect(screen.getByRole('button', { name: 'Settings for Route' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings for Day' })).toBeInTheDocument()
  })

  // In the editor the set of parameters grows as the SQL is typed, so the bar
  // meets parameters it did not have at mount. Its value state is seeded once,
  // so anything not derived from the prop would render blank and, worse, send
  // nothing for a parameter the backend requires.
  it('shows a parameter that appeared after mount, at its saved default', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = renderWithProviders(
      <ParametersBar parameters={[PARAMS[0]]} onChange={onChange} />
    )

    const grown = [...PARAMS, { name: 'city', title: 'City', type: 'text', value: 'City A' }]
    rerender(<ParametersBar parameters={grown} onChange={onChange} />)

    expect(screen.getByLabelText('City')).toHaveValue('City A')
    // And it is not counted as an unapplied edit: nobody changed anything.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Applying has to carry it too. Leaving it out is the same failure as
    // sending no parameters at all: the backend refuses the run.
    await user.click(screen.getByRole('button', { name: 'Apply Changes' }))

    expect(onChange).toHaveBeenLastCalledWith({ route_id: '12', day: '', city: 'City A' })
  })

  it('hands back the parameter that was clicked', async () => {
    const user = userEvent.setup()
    const onEditParameter = vi.fn()
    renderWithProviders(
      <ParametersBar parameters={PARAMS} onChange={vi.fn()} onEditParameter={onEditParameter} />
    )

    await user.click(screen.getByRole('button', { name: 'Settings for Day' }))

    expect(onEditParameter).toHaveBeenCalledWith(PARAMS[1])
  })
})
