/**
 * Edits to a parameter are pending until Apply commits them, so the bar has to
 * say so. Without it, a filled-in form and an applied form look identical, and
 * the run the viewer starts from anywhere else on the page silently uses the
 * old values. Redash solves it the same way: a count of pending changes on the
 * Apply control, and no way to execute past it.
 */
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MockQueryParameter } from '@/lib/mock-data'
import { renderWithProviders } from '@/test/utils'
import { ParametersBar } from './parameters-bar'

const PARAMS: MockQueryParameter[] = [
  { name: 'route_id', title: 'Route', type: 'text', value: '901' },
  { name: 'days', title: 'Days', type: 'number', value: 7 },
]

describe('ParametersBar pending changes', () => {
  it('says nothing is pending before anything is edited', () => {
    renderWithProviders(<ParametersBar parameters={PARAMS} onChange={vi.fn()} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('counts an edited parameter as pending', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ParametersBar parameters={PARAMS} onChange={vi.fn()} />)

    await user.clear(screen.getByLabelText('Route'))
    await user.type(screen.getByLabelText('Route'), '12')

    expect(screen.getByRole('status')).toHaveTextContent('1 change not applied')
  })

  it('counts each edited parameter separately', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ParametersBar parameters={PARAMS} onChange={vi.fn()} />)

    await user.clear(screen.getByLabelText('Route'))
    await user.type(screen.getByLabelText('Route'), '12')
    await user.clear(screen.getByLabelText('Days'))
    await user.type(screen.getByLabelText('Days'), '30')

    expect(screen.getByRole('status')).toHaveTextContent('2 changes not applied')
  })

  // Typing back to where you started is not a pending change. Counting it would
  // leave the run blocked with nothing to apply.
  it('stops counting a parameter edited back to its original value', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ParametersBar parameters={PARAMS} onChange={vi.fn()} />)

    await user.clear(screen.getByLabelText('Route'))
    await user.type(screen.getByLabelText('Route'), '12')
    await user.clear(screen.getByLabelText('Route'))
    await user.type(screen.getByLabelText('Route'), '901')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('clears the count once the changes are applied', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ParametersBar parameters={PARAMS} onChange={vi.fn()} />)

    await user.clear(screen.getByLabelText('Route'))
    await user.type(screen.getByLabelText('Route'), '12')
    await user.click(screen.getByRole('button', { name: 'Apply Changes' }))

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  // A range value is an object, so an identity comparison calls it changed on
  // every render and the run would be blocked with nothing to apply.
  it('compares a range by its dates, not by object identity', async () => {
    const user = userEvent.setup()
    const range: MockQueryParameter[] = [
      { name: 'window', title: 'Window', type: 'date-range', value: { start: '2026-07-01', end: '2026-07-31' } },
    ]
    renderWithProviders(<ParametersBar parameters={range} onChange={vi.fn()} />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Window start'))
    await user.type(screen.getByLabelText('Window start'), '2026-07-10')

    expect(screen.getByRole('status')).toHaveTextContent('1 change not applied')

    await user.clear(screen.getByLabelText('Window start'))
    await user.type(screen.getByLabelText('Window start'), '2026-07-01')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('reports the pending count to the page that owns the run', async () => {
    const user = userEvent.setup()
    const onDirtyChange = vi.fn()
    renderWithProviders(
      <ParametersBar parameters={PARAMS} onChange={vi.fn()} onDirtyChange={onDirtyChange} />
    )

    await user.clear(screen.getByLabelText('Route'))
    await user.type(screen.getByLabelText('Route'), '12')

    expect(onDirtyChange).toHaveBeenLastCalledWith(1)

    await user.click(screen.getByRole('button', { name: 'Apply Changes' }))

    expect(onDirtyChange).toHaveBeenLastCalledWith(0)
  })
})
