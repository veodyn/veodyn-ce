import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import NewConnectorPage from '@/app/connectors/new/page'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: toastError, success: toastSuccess }) }
})

const types = [
  {
    connectorId: 'town-crier',
    displayName: 'Town Crier',
    recallable: true,
    credentialSchema: {
      properties: {
        crier_token: { type: 'string', title: 'Crier API token' },
        crier_room: { type: 'string', title: 'Room' },
      },
      required: ['crier_token', 'crier_room'],
      secret: ['crier_token'],
      order: ['crier_token', 'crier_room'],
    },
    contentContract: {
      maxLength: 280,
      supportsMarkup: false,
      urlCountsAsCharacters: 23,
      requiredFooter: 'Reply STOP to opt out.',
    },
  },
  {
    connectorId: 'pigeon-post',
    displayName: 'Pigeon Post',
    recallable: false,
    credentialSchema: {
      properties: {
        loft_id: { type: 'string', title: 'Loft identifier' },
        ring_secret: { type: 'string', title: 'Ring secret' },
      },
      required: ['loft_id'],
      secret: ['ring_secret'],
      order: ['loft_id', 'ring_secret'],
    },
    contentContract: {
      maxLength: null,
      supportsMarkup: true,
      urlCountsAsCharacters: null,
      requiredFooter: null,
    },
  },
]

let posted: unknown
let postCount = 0

beforeEach(() => {
  push.mockClear()
  toastError.mockClear()
  toastSuccess.mockClear()
  posted = undefined
  postCount = 0
  server.use(
    http.get('/api/connectors/types', () => HttpResponse.json(types)),
    http.post('/api/connectors', async ({ request }) => {
      postCount += 1
      posted = await request.json()
      return HttpResponse.json({}, { status: 201 })
    })
  )
})

afterEach(() => resetStores())

async function pick(user: ReturnType<typeof userEvent.setup>, label: string) {
  renderWithProviders(<NewConnectorPage />)
  await user.click(await screen.findByRole('button', { name: label }))
}

describe('configuring a connector the registry declares', () => {
  it('offers every registered connector as a type, by its declared display name', async () => {
    renderWithProviders(<NewConnectorPage />)

    expect(await screen.findByRole('button', { name: 'Town Crier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pigeon Post' })).toBeInTheDocument()
  })

  it('renders each connector its own credential fields, from its own schema', async () => {
    const user = userEvent.setup()
    await pick(user, 'Town Crier')

    expect(screen.getByLabelText(/^Crier API token/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Room/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Loft identifier/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Pigeon Post' }))

    expect(screen.getByLabelText(/^Loft identifier/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Crier API token/)).not.toBeInTheDocument()
  })

  it('shows what the declared content contract accepts, per connector', async () => {
    const user = userEvent.setup()
    await pick(user, 'Town Crier')

    expect(screen.getByText(/280 characters/)).toBeInTheDocument()
    expect(screen.getByText(/counts as 23 characters/)).toBeInTheDocument()
    expect(screen.getByText(/Reply STOP to opt out/)).toBeInTheDocument()
    expect(screen.getByText(/can be recalled/)).toBeInTheDocument()
  })

  it('says a channel cannot be recalled where the connector declares that', async () => {
    const user = userEvent.setup()
    await pick(user, 'Pigeon Post')

    expect(screen.getByText(/cannot be recalled/)).toBeInTheDocument()
    expect(screen.getByText(/accepts markup/)).toBeInTheDocument()
  })

  it('sends only the credential keys the chosen connector declared', async () => {
    const user = userEvent.setup()
    await pick(user, 'Town Crier')

    await user.type(screen.getAllByRole('textbox')[0], 'Agency crier')
    await user.type(screen.getByLabelText(/^Crier API token/), 'crier-live-8f3a2b')
    await user.type(screen.getByLabelText(/^Room/), 'market-square')
    await user.click(screen.getByRole('button', { name: 'Save and test' }))

    await waitFor(() =>
      expect(posted).toEqual({
        connectorId: 'town-crier',
        name: 'Agency crier',
        credentials: { crier_token: 'crier-live-8f3a2b', crier_room: 'market-square' },
      })
    )
    await waitFor(() => expect(push).toHaveBeenCalledWith('/connectors'))
  })

  it('drops what was typed into the previous connector when the type changes', async () => {
    const user = userEvent.setup()
    await pick(user, 'Town Crier')

    await user.type(screen.getAllByRole('textbox')[0], 'Agency crier')
    await user.type(screen.getByLabelText(/^Room/), 'market-square')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Pigeon Post' }))

    await user.type(screen.getAllByRole('textbox')[0], 'Agency pigeons')
    await user.type(screen.getByLabelText(/^Loft identifier/), 'loft-4')
    await user.click(screen.getByRole('button', { name: 'Save and test' }))

    await waitFor(() => expect(posted).toBeDefined())
    expect((posted as { credentials: Record<string, unknown> }).credentials).toEqual({ loft_id: 'loft-4' })
  })

  it('marks the Name field and required schema fields, and leaves the optional one unmarked', async () => {
    const user = userEvent.setup()
    await pick(user, 'Pigeon Post')

    expect(screen.getByText('Name').querySelector('[data-slot="required-marker"]')).not.toBeNull()
    expect(screen.getAllByRole('textbox')[0]).toBeRequired()

    expect(
      screen.getByText('Loft identifier').querySelector('[data-slot="required-marker"]')
    ).not.toBeNull()
    expect(screen.getByLabelText(/^Loft identifier/)).toBeRequired()

    expect(screen.getByText('Ring secret').querySelector('[data-slot="required-marker"]')).toBeNull()
  })

  it('blocks a save that omits a required credential and names the field', async () => {
    const user = userEvent.setup()
    await pick(user, 'Town Crier')

    await user.type(screen.getAllByRole('textbox')[0], 'Agency crier')
    await user.type(screen.getByLabelText(/^Crier API token/), 'crier-live-8f3a2b')
    await user.click(screen.getByRole('button', { name: 'Save and test' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Room')
    expect(postCount).toBe(0)
    expect(push).not.toHaveBeenCalled()
  })

  it('shows the refusal a failed credential test comes back with, and stays on the form', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/connectors', () =>
        HttpResponse.json(
          { error: { id: 'VEODYN_CONNECTOR_CREDENTIALS_REFUSED', message: 'town-crier refused these credentials' } },
          { status: 422 }
        )
      )
    )
    await pick(user, 'Town Crier')

    await user.type(screen.getAllByRole('textbox')[0], 'Agency crier')
    await user.type(screen.getByLabelText(/^Crier API token/), 'crier-expired-0000')
    await user.type(screen.getByLabelText(/^Room/), 'market-square')
    await user.click(screen.getByRole('button', { name: 'Save and test' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('town-crier refused these credentials'))
    expect(await screen.findByRole('alert')).toHaveTextContent('town-crier refused these credentials')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getAllByRole('textbox')[0]).toHaveValue('Agency crier')
  })

  it('says so rather than offering an empty picker when this build installs no connector', async () => {
    server.use(http.get('/api/connectors/types', () => HttpResponse.json([])))
    renderWithProviders(<NewConnectorPage />)

    expect(await screen.findByText(/installs no channel connectors/)).toBeInTheDocument()
  })
})
