import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useAuthStore } from '@/stores/auth-store'
import { LoginScreen } from './login-screen'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), back: vi.fn() }),
}))

const PERSONAS = [
  {
    id: 'operations',
    label: 'Operations lead',
    email: 'demo-ops@example.com',
    description: 'Runs the network view',
  },
  { id: 'analyst', label: 'Analyst', email: 'demo-analyst@example.com', description: null },
]

const withPersonas = { config: { demo: { personas: PERSONAS } }, authenticated: false }

afterEach(() => {
  replace.mockClear()
  resetStores()
  useAuthStore.setState({ loginError: null })
})

describe('the demo persona buttons on the sign-in card', () => {
  it('are absent on an instance that configures no personas', () => {
    renderWithProviders(<LoginScreen />, { authenticated: false })

    expect(screen.queryByRole('button', { name: /sign in as/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/explore the demo/i)).not.toBeInTheDocument()
  })

  it('offers one button per configured persona, naming what each one is', () => {
    renderWithProviders(<LoginScreen />, withPersonas)

    expect(screen.getByRole('button', { name: /sign in as Operations lead/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in as Analyst/i })).toBeInTheDocument()
    expect(screen.getByText('Runs the network view')).toBeInTheDocument()
  })

  it('signs in through the persona rather than the credential form', async () => {
    const user = userEvent.setup()
    const loginAsDemo = vi.fn(async () => true)
    const login = vi.fn(async () => true)
    useAuthStore.setState({ loginAsDemo, login })

    renderWithProviders(<LoginScreen next="/dashboards" />, withPersonas)
    await user.click(screen.getByRole('button', { name: /sign in as Analyst/i }))

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboards'))
    expect(loginAsDemo).toHaveBeenCalledWith(PERSONAS[1])
    expect(login).not.toHaveBeenCalled()
  })

  it('re-arms the buttons and shows the reason when a demo sign-in is refused', async () => {
    const user = userEvent.setup()
    useAuthStore.setState({
      loginAsDemo: async () => {
        useAuthStore.setState({ loginError: 'Demo sign-in is not enabled on this instance.' })
        return false
      },
    })

    renderWithProviders(<LoginScreen />, withPersonas)
    await user.click(screen.getByRole('button', { name: /sign in as Analyst/i }))

    expect(
      await screen.findByText('Demo sign-in is not enabled on this instance.')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in as Analyst/i })).toBeEnabled()
    expect(replace).not.toHaveBeenCalled()
  })
})
