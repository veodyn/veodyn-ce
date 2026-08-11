import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ConfigProvider } from '@/components/config/config-provider'
import { toClientConfig, NEUTRAL_CONFIG } from '@/lib/config-schema'
import { VerifyTokenView } from './verify-token-view'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const configValue = toClientConfig(NEUTRAL_CONFIG)

function renderVerifyView(token: string) {
  return renderWithProviders(
    <ConfigProvider value={configValue}>
      <VerifyTokenView token={token} />
    </ConfigProvider>
  )
}

afterEach(() => {
  resetStores()
  push.mockReset()
})

describe('VerifyTokenView', () => {
  it('tells the user their email is verified and offers a way into the app', async () => {
    server.use(
      http.get('/api/verify/good-token', () => HttpResponse.json({ status: 'verified' }))
    )
    renderVerifyView('good-token')

    expect(await screen.findByText('Your email is verified.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue to/i })).toBeInTheDocument()
  })

  it('tells the user an invalid or expired link is invalid, not the raw backend response', async () => {
    server.use(
      http.get('/api/verify/bad-token', () => HttpResponse.json({ status: 'invalid' }, { status: 400 }))
    )
    renderVerifyView('bad-token')

    expect(
      await screen.findByText(/verification link is invalid or has expired/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/error\.html/i)).not.toBeInTheDocument()
  })

  it('tells the user about a network failure distinctly from a rejected token', async () => {
    server.use(http.get('/api/verify/unreachable-token', () => HttpResponse.error()))
    renderVerifyView('unreachable-token')

    expect(await screen.findByText('Could not reach the server. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/verification link is invalid or has expired/i)).not.toBeInTheDocument()
  })
})
