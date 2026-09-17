import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import DashboardsPage from '@/app/dashboards/page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => resetStores())

describe('the New Dashboard dialog', () => {
  it('marks the dashboard name required', async () => {
    const user = userEvent.setup()
    renderWithProviders(<DashboardsPage />)

    await user.click(await screen.findByRole('button', { name: 'New Dashboard' }))

    expect(
      screen.getByText('Dashboard Name').querySelector('[data-slot="required-marker"]')
    ).not.toBeNull()
    expect(screen.getByRole('textbox', { name: 'Dashboard Name' })).toBeRequired()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })
})
