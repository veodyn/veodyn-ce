import { afterEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import ProfilePage from './page'

afterEach(() => resetStores())

// These run in mock mode, which is what the suite and a fresh clone both use:
// NEXT_PUBLIC_REDASH_URL is unset, so USE_REAL_API is false and the page reads
// the mock store rather than the proxy. That is deliberate. Stubbing the proxy
// with msw instead would prove the page works in a mode these tests never run
// in, while the mode it ships in went unexercised.
const MOCK_ADMIN = { id: 1, name: 'Admin User', apiKey: 'mock-api-key-admin-001' }

/** renderWithProviders sets isAuthenticated and isLoading but never currentUser. */
function signIn(id = MOCK_ADMIN.id) {
  useAuthStore.setState({ currentUser: { id, name: 'Whoever' } as CurrentUser })
}

describe('ProfilePage', () => {
  it('loads in mock mode, with no Redash backend configured', async () => {
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: MOCK_ADMIN.name })).toBeInTheDocument()
    )
    expect(screen.queryByText(/could not load your profile/i)).not.toBeInTheDocument()
  })

  it('renders the account and API key sections for the signed-in user', async () => {
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /account/i })).toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: /show api key/i })).toBeInTheDocument()
  })

  it('reveals the real key rather than a placeholder', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /show api key/i })).toBeInTheDocument()
    )
    await user.click(screen.getByRole('button', { name: /show api key/i }))
    expect(screen.getByText(MOCK_ADMIN.apiKey)).toBeInTheDocument()
  })

  it('titles the page "Profile" and demotes the identity name to an h2', async () => {
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: MOCK_ADMIN.name })).toBeInTheDocument()
    )
    // The one h1 is the PageHeader every other route uses, not the user's name:
    // /profile used to have no page title at all.
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Profile')
    expect(screen.getByRole('heading', { name: MOCK_ADMIN.name, level: 2 })).toBeInTheDocument()
  })

  it('offers to change your password, which is the point of it being your own page', async () => {
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument()
    )
  })

  it('keeps Groups with Security rather than below your content', async () => {
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Groups' })).toBeInTheDocument())
    const groups = screen.getByRole('heading', { name: 'Groups' })
    const password = screen.getByRole('button', { name: /change password/i })
    const yourQueries = screen.getByRole('heading', { name: /your queries/i })

    expect(password.compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(
      groups.compareDocumentPosition(yourQueries) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('never shows the admin-only reset and invitation actions', async () => {
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /account/i })).toBeInTheDocument()
    )
    expect(screen.queryByRole('button', { name: /send password reset/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resend invitation/i })).not.toBeInTheDocument()
  })

  it('moves the signed-in identity along with a saved email', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    signIn()
    renderWithProviders(<ProfilePage />)

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /account/i })).toBeInTheDocument()
    )
    const email = screen.getByLabelText(/email/i)
    await user.clear(email)
    await user.type(email, 'moved@veodyn.com')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Not just the query cache: the email is the sign-in identity, so leaving
    // useAuthStore on the old one means the next sign-in rejects the address
    // the page just said it saved.
    await waitFor(() =>
      expect(useAuthStore.getState().currentUser?.email).toBe('moved@veodyn.com')
    )
  })

  it('says so plainly when nobody is signed in', async () => {
    renderWithProviders(<ProfilePage />, { authenticated: false })

    await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeInTheDocument())
  })
})
