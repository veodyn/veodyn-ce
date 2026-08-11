import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { mockQueries } from '@/lib/mock-data'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ApiKeyDialog } from './api-key-dialog'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: toastError, success: toastSuccess }) }
})

beforeEach(() => {
  toastError.mockClear()
  toastSuccess.mockClear()
})

afterEach(() => resetStores())

describe('ApiKeyDialog', () => {
  it('renders the API key and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <ApiKeyDialog open onClose={onClose} queryId={7} apiKey="query-key-123" />
    )

    expect(screen.getByText(/query api key/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('query-key-123')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The dialog was handed `query.user.email` as the key, so it displayed the
  // author's address under an "API Key" label and copied it to the clipboard.
  // An absent key must therefore read as absent, never fall back to whatever
  // string is nearby.
  it('says so when the query has no key, rather than showing an empty field', () => {
    renderWithProviders(<ApiKeyDialog open onClose={() => {}} queryId={7} apiKey={undefined} />)

    expect(screen.getByText(/this query has no api key/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  // The Regenerate button was wired to `() => {}` at both call sites, rotating
  // nothing. Redash does expose POST /api/queries/<id>/regenerate_api_key
  // (QueryRegenerateApiKeyResource), so it is wired rather than removed.
  it('rotates the key through the endpoint, after a confirm', async () => {
    const user = userEvent.setup()
    let called = 0
    server.use(
      http.post('/api/node/queries/7/regenerate_api_key', () => {
        called += 1
        return HttpResponse.json({ ...mockQueries[0], id: 7, api_key: 'rotated-key' })
      })
    )

    renderWithProviders(<ApiKeyDialog open onClose={() => {}} queryId={7} apiKey="query-key-123" />)

    // One click arms it; rotating breaks every URL built from the old key and
    // there is no undo.
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    expect(called).toBe(0)

    await user.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() => expect(called).toBe(1))
  })

  it('reports a refused rotation rather than claiming success', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/node/queries/7/regenerate_api_key', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 })
      )
    )

    renderWithProviders(<ApiKeyDialog open onClose={() => {}} queryId={7} apiKey="query-key-123" />)
    await user.click(screen.getByRole('button', { name: 'Regenerate' }))
    await user.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  // With no key there is nothing to rotate.
  it('offers no regenerate control when there is no key', () => {
    renderWithProviders(<ApiKeyDialog open onClose={() => {}} queryId={7} apiKey={undefined} />)

    expect(screen.queryByRole('button', { name: /regenerate/i })).not.toBeInTheDocument()
  })
})
