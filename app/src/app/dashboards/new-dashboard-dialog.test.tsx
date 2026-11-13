import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardsPage from '@/app/dashboards/page'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => {
  resetStores()
  push.mockClear()
})

describe('the New Dashboard dialog', () => {
  it('marks the dashboard name required', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DashboardsPage />)

    await user.click(await screen.findByRole('button', { name: 'New Dashboard' }))

    expect(
      screen.getByText('Dashboard Name').querySelector('[data-slot="required-marker"]')
    ).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Dashboard Name' })).toBeRequired()
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('flags an empty name on the field, links the message and focuses it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DashboardsPage />)

    await user.click(await screen.findByRole('button', { name: 'New Dashboard' }))
    await user.click(screen.getByRole('button', { name: 'Create' }))

    const field = screen.getByRole('textbox', { name: 'Dashboard Name' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Give the dashboard a name.')
    expect(field).toHaveFocus()

    await user.type(field, 'W')

    expect(field).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Give the dashboard a name.')).toBeNull()
  })

  it('creates the dashboard when Enter is pressed in the name field', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DashboardsPage />)

    await user.click(await screen.findByRole('button', { name: 'New Dashboard' }))
    await user.type(screen.getByRole('textbox', { name: 'Dashboard Name' }), 'Weekly revenue{Enter}')

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/dashboards\/./)))
  })
})
