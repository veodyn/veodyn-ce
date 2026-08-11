import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ScheduleDialog } from './schedule-dialog'

afterEach(() => resetStores())

describe('ScheduleDialog', () => {
  it('renders schedule fields and calls onClose from Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <ScheduleDialog open onClose={onClose} schedule={null} onSave={() => {}} />
    )

    expect(screen.getByText(/schedule query/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/refresh every/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('associates every visible schedule control with its label', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <ScheduleDialog open onClose={() => {}} schedule={null} onSave={() => {}} />
    )

    expect(screen.getByLabelText(/refresh every/i)).toBeInTheDocument()

    // At Time, On Day and Until only render once the interval selected makes
    // them relevant, so pick "Every week" to bring all three into the DOM.
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Every week' }))

    expect(screen.getByLabelText(/at time/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/on day/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/until \(optional\)/i)).toBeInTheDocument()
  })

  it('passes the selected schedule to onSave', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <ScheduleDialog open onClose={onClose} schedule={null} onSave={onSave} />
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'Every 1 hour' }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith({
      interval: 3600,
      time: null,
      day_of_week: null,
      until: null,
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
