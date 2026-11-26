import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import type { MockDashboard } from '@/lib/mock-data'
import { EditDashboardButton, editRefusal } from './edit-dashboard-button'

function dashboard(canEdit: boolean, ownerName = 'admin'): MockDashboard {
  return {
    id: 22,
    name: 'Closure monitoring',
    slug: '22',
    tags: [],
    is_archived: false,
    is_draft: false,
    is_favorite: false,
    can_edit: canEdit,
    user: { id: 1, name: ownerName, email: '' },
    widgets: [],
    dashboard_filters_enabled: false,
    created_at: '2026-11-05T00:00:00Z',
    updated_at: '2026-11-05T00:00:00Z',
    public_url: null,
    api_key: null,
  }
}

describe('EditDashboardButton', () => {
  it('starts an edit session for someone who may modify the dashboard', async () => {
    const onEdit = vi.fn()
    renderWithProviders(<EditDashboardButton dashboard={dashboard(true)} onEdit={onEdit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('refuses a viewer and says who can edit', async () => {
    const onEdit = vi.fn()
    renderWithProviders(<EditDashboardButton dashboard={dashboard(false)} onEdit={onEdit} />)
    const button = screen.getByRole('button', { name: 'Edit' })

    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(button)
    expect(onEdit).not.toHaveBeenCalled()

    await userEvent.hover(button)
    expect(await screen.findByText('Only admin can edit this dashboard.')).toBeInTheDocument()
  })

  it('falls back to the owner when the dashboard carries no owner name', () => {
    expect(editRefusal('  ')).toBe('Only its owner can edit this dashboard.')
  })
})
