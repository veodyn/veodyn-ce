import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { AdminUserList } from './admin-user-list'
import { serveUserList, userRow } from './admin-user-fixtures'
import { signInAsAdmin, signInAsMember } from './users-admin-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(() => resetStores())

const ROOT = userRow({ id: 1, name: 'Root Admin', email: 'root@example.com' })
const JANE = userRow({ id: 2, name: 'Jane Analyst', email: 'jane@example.com' })

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent)

describe('AdminUserList permission surface', () => {
  it('shows a normal member the roster and none of the controls that change it', async () => {
    signInAsMember(JANE.id)
    serveUserList([ROOT, JANE])
    renderWithProviders(<AdminUserList />)

    // Positive first: both people are listed, so the absences below are about
    // permission rather than about a table that never rendered.
    expect(await screen.findByRole('link', { name: 'Root Admin' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Jane Analyst' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /new user/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument()
    // Disabled accounts are an admin's view of the instance, not a colleague's.
    expect(tabNames()).toEqual(['Active Users', 'Pending Invitations'])
  })

  it('gives an admin the invite button, the disabled filter and the row actions', async () => {
    signInAsAdmin(ROOT.id)
    serveUserList([ROOT, JANE])
    renderWithProviders(<AdminUserList />)

    expect(await screen.findByRole('link', { name: 'Jane Analyst' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new user/i })).toBeInTheDocument()
    expect(tabNames()).toEqual(['Active Users', 'Pending Invitations', 'Disabled Users'])
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument()
  })

  it('offers an admin no action on their own row', async () => {
    signInAsAdmin(ROOT.id)
    serveUserList([ROOT, JANE])
    renderWithProviders(<AdminUserList />)

    // Exactly one Disable, and it belongs to the other person. An admin who
    // disables their own account locks themself out of the instance, and the
    // guard is an id comparison that a self-row would otherwise sail past.
    const disable = await screen.findByRole('button', { name: 'Disable' })
    const row = disable.closest('tr')
    expect(row).toHaveTextContent('Jane Analyst')
    expect(row).not.toHaveTextContent('Root Admin')
    expect(screen.getAllByRole('button', { name: 'Disable' })).toHaveLength(1)
  })

  it('offers Enable rather than Disable on an account that is already disabled', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    const disabledJane = userRow({ ...JANE, is_disabled: true, disabled_at: JANE.updated_at })
    serveUserList([disabledJane])
    renderWithProviders(<AdminUserList />)

    // The default tab lists active accounts only, so this row arrives through
    // the Disabled Users filter: reaching it at all proves the tab drives the
    // request rather than only the underline.
    await user.click(screen.getByRole('tab', { name: 'Disabled Users' }))

    expect(await screen.findByRole('button', { name: 'Enable' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument()
  })

  it('offers Delete rather than Disable on an invitation nobody has accepted', async () => {
    const user = userEvent.setup()
    signInAsAdmin(ROOT.id)
    const invited = userRow({ id: 5, name: 'Pending User', is_invitation_pending: true })
    serveUserList([invited])
    renderWithProviders(<AdminUserList />)

    await user.click(screen.getByRole('tab', { name: 'Pending Invitations' }))

    expect(await screen.findByRole('link', { name: 'Pending User' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    // Disabling an account that was never used is not the action a person
    // wants here, and offering both would make the destructive one a coin toss.
    expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument()
  })
})
