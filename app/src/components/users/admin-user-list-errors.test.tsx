import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { AdminUserList } from './admin-user-list'
import { serveUserList, userRow } from './admin-user-fixtures'
import { signInAsAdmin } from './users-admin-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

afterEach(() => resetStores())

const JANE = userRow({ id: 2, name: 'Jane Analyst' })

// The failure mode this pins is the one nobody files: a refused fetch that
// renders as a calm "No users found", which reads as "there are none" and
// sends the reader looking for a missing account instead of a broken backend.
describe('AdminUserList load failure', () => {
  it('reports the failure in the words the backend used, not as an empty table', async () => {
    signInAsAdmin()
    serveUserList([JANE], { failWith: 'data source is unreachable' })
    renderWithProviders(<AdminUserList />)

    expect(await screen.findByText('Could not load users')).toBeInTheDocument()
    expect(screen.getByText('data source is unreachable')).toBeInTheDocument()

    expect(screen.queryByText('No users found')).not.toBeInTheDocument()
    // No count either. "0 users" beside a failure is a claim about the data
    // that the app is in no position to make.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('recovers from the retry button rather than needing a reload', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    const { loadCount } = serveUserList([JANE], { failFirstLoad: 'backend refused' })
    renderWithProviders(<AdminUserList />)

    expect(await screen.findByText('Could not load users')).toBeInTheDocument()
    expect(loadCount()).toBe(1)

    await user.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('link', { name: 'Jane Analyst' })).toBeInTheDocument()
    // The panel is replaced by the table, not left stacked above it.
    await waitFor(() => expect(screen.queryByText('Could not load users')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('1 user')
  })
})
