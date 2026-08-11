// The window between "credentials accepted" and "destination on screen".
//
// The card used to re-arm itself the moment the session landed: `loading` went
// back to false while the router was still fetching the page it was sending the
// user to. On stage that gap runs to seconds, so a sign-in that had already
// worked looked like a button that did nothing, and people clicked it again.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore } from '@/stores/auth-store'
import { LoginScreen, safeNextPath } from './login-screen'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
}))

afterEach(() => {
  replace.mockClear()
  resetStores()
  useAuthStore.setState({ loginError: null })
})

describe('the sign-in card while it is handing over to the router', () => {
  it('leaves the button disabled once the credentials are accepted', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginScreen next="/queries" />, { authenticated: false })

    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/queries'))

    // Still on screen, still busy. The navigation has been asked for but the
    // destination has not rendered, and this is exactly the window the user
    // reads as a dead click if the control comes back to life.
    const button = screen.getByRole('button', { name: /signing in/i })
    expect(button).toBeDisabled()
    expect(screen.queryByText(/login failed/i)).not.toBeInTheDocument()
  })

  it('re-arms the button when the credentials are refused', async () => {
    const user = userEvent.setup()
    renderWithProviders(<LoginScreen />, { authenticated: false })

    await user.clear(screen.getByLabelText(/email/i))
    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled())
    expect(replace).not.toHaveBeenCalled()
  })

  it('shows the reason the backend gave rather than a guess about the password', async () => {
    const user = userEvent.setup()
    // Whatever the store recorded is what the reader sees. Here it stands in
    // for the 503 the route answers when Redash has no organization yet.
    vi.spyOn(useAuthStore.getState(), 'login').mockImplementation(async () => {
      useAuthStore.setState({ loginError: 'The query service is not ready. Organization may need setup.' })
      return false
    })

    renderWithProviders(<LoginScreen />, { authenticated: false })
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    expect(
      await screen.findByText('The query service is not ready. Organization may need setup.')
    ).toBeInTheDocument()
  })
})

describe('safeNextPath', () => {
  it('keeps a same-origin path', () => {
    expect(safeNextPath('/queries?tab=my')).toBe('/queries?tab=my')
  })

  it('refuses anything that would leave the origin', () => {
    expect(safeNextPath('//evil.example')).toBe('/')
    expect(safeNextPath('/\\evil.example')).toBe('/')
    expect(safeNextPath('https://evil.example/x')).toBe('/')
    expect(safeNextPath(null)).toBe('/')
  })
})
