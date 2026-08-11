import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { TokenPasswordForm } from './token-password-form'

const push = vi.fn()
const replace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}))

const configValue = toClientConfig(NEUTRAL_CONFIG)

function renderTokenForm(props: { token: string; mode: 'invite' | 'reset' }) {
  return renderWithProviders(
    <ConfigProvider value={configValue}>
      <TokenPasswordForm {...props} />
    </ConfigProvider>
  )
}

afterEach(() => {
  resetStores()
  push.mockReset()
  replace.mockReset()
})

function validateResetToken() {
  server.use(
    http.get('/api/node/reset/reset-token', () =>
      HttpResponse.json({ user: { name: 'Test User', email: 'test@example.com' } })
    )
  )
}

describe('TokenPasswordForm', () => {
  it('renders the validated user and password fields', async () => {
    validateResetToken()
    renderTokenForm({ token: 'reset-token', mode: 'reset' })

    expect(await screen.findByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('test@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeRequired()
    expect(screen.getByLabelText('Confirm password')).toBeRequired()
    expect(screen.getByRole('button', { name: 'Set new password' })).toBeDisabled()
  })

  it('blocks a password shorter than six characters', async () => {
    const user = userEvent.setup()
    let postCount = 0
    validateResetToken()
    server.use(
      http.post('/api/node/reset/reset-token', () => {
        postCount += 1
        return HttpResponse.json({})
      })
    )
    renderTokenForm({ token: 'reset-token', mode: 'reset' })

    await screen.findByLabelText('New password')
    await user.type(screen.getByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Confirm password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    expect(screen.getByText('Password must be at least 6 characters.')).toBeInTheDocument()
    expect(postCount).toBe(0)
  })

  it('posts a valid password to the token endpoint', async () => {
    const user = userEvent.setup()
    let requestBody: unknown
    validateResetToken()
    server.use(
      http.post('/api/node/reset/reset-token', async ({ request }) => {
        requestBody = await request.json()
        return HttpResponse.json({})
      })
    )
    renderTokenForm({ token: 'reset-token', mode: 'reset' })

    await screen.findByLabelText('New password')
    await user.type(screen.getByLabelText('New password'), 'secret7')
    await user.type(screen.getByLabelText('Confirm password'), 'secret7')
    await user.click(screen.getByRole('button', { name: 'Set new password' }))

    await waitFor(() => expect(requestBody).toEqual({ password: 'secret7' }))
    expect(screen.getByText(/password updated/i)).toBeInTheDocument()
  })
})
