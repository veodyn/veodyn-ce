import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import ConnectorEditPage from '@/app/connectors/[connectorId]/page'
import type { Connector } from '@/types/connector'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: vi.fn(), success: vi.fn() }) }
})

const types = [
  {
    connectorId: 'town-crier',
    displayName: 'Town Crier',
    recallable: true,
    credentialSchema: {
      properties: {
        crier_token: { type: 'string', title: 'Crier API token' },
        crier_confirm: { type: 'boolean', title: 'Confirm delivery' },
      },
      required: ['crier_token', 'crier_confirm'],
      clearable: [],
      secret: ['crier_token'],
      order: ['crier_token', 'crier_confirm'],
    },
    contentContract: {
      maxLength: 280,
      supportsMarkup: false,
      urlCountsAsCharacters: 23,
      requiredFooter: 'Reply STOP to opt out.',
    },
  },
]

const UNCONFIGURED: Connector = {
  connectorId: 'town-crier',
  displayName: 'Town Crier',
  name: 'Agency crier',
  recallable: true,
  configuredFields: [],
  health: {
    delivery: 'untested',
    credentialsVerifiedAt: '2026-08-28T10:00:00Z',
    lastDeliveryAt: null,
    lastDeliveryDetail: null,
  },
}

let put: unknown
let putCount = 0

beforeEach(() => {
  put = undefined
  putCount = 0
  server.use(
    http.get('/api/connectors/types', () => HttpResponse.json(types)),
    http.get('/api/connectors/town-crier', () => HttpResponse.json(UNCONFIGURED)),
    http.put('/api/connectors/town-crier', async ({ request }) => {
      putCount += 1
      put = await request.json()
      return HttpResponse.json(UNCONFIGURED)
    })
  )
})

afterEach(() => resetStores())

async function render() {
  await act(async () => {
    renderWithProviders(<ConnectorEditPage params={Promise.resolve({ connectorId: 'town-crier' })} />)
  })
  await screen.findByRole('button', { name: 'Save' })
}

describe('a required credential the schema declares as a boolean', () => {
  it('never requires the checkbox, and accepts it unchecked', async () => {
    const user = userEvent.setup()
    await render()

    const checkbox = screen.getByRole('checkbox', { name: 'Confirm delivery' })
    expect(checkbox).not.toBeRequired()
    expect(checkbox).not.toHaveAttribute('aria-required')
    expect(checkbox).not.toBeChecked()

    await user.type(screen.getByLabelText('Crier API token*'), 'crier-live-8f3a2b')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await vi.waitFor(() => expect(putCount).toBe(1))
    expect(put).toMatchObject({ replace: { crier_confirm: false, crier_token: 'crier-live-8f3a2b' } })
  })
})
