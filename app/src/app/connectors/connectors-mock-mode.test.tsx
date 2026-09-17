import { Suspense, type ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import ConnectorEditPage from '@/app/connectors/[connectorId]/page'
import ConnectorsPage from '@/app/connectors/page'
import NewConnectorPage from '@/app/connectors/new/page'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { Connector, ConnectorType } from '@/types/connector'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/components/shared/toast-provider', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared/toast-provider')>(
    '@/components/shared/toast-provider'
  )
  return { ...actual, useToast: () => ({ error: vi.fn(), success: vi.fn() }) }
})

const X = 'x_post'

const A_TYPE: ConnectorType = {
  connectorId: X,
  displayName: 'X (agency account)',
  recallable: false,
  credentialSchema: {
    properties: { x_access_token: { type: 'string', title: 'X user access token' } },
    required: ['x_access_token'],
    clearable: [],
    secret: ['x_access_token'],
  },
  contentContract: {
    maxLength: 280,
    supportsMarkup: false,
    urlCountsAsCharacters: 23,
    requiredFooter: null,
  },
}

const CONFIGURED: Connector = {
  connectorId: X,
  displayName: 'X (agency account)',
  name: 'Agency X account',
  recallable: false,
  configuredFields: ['x_access_token'],
  health: {
    delivery: 'delivering',
    credentialsVerifiedAt: '2026-08-20T09:00:00.000Z',
    lastDeliveryAt: '2026-08-26T17:42:00.000Z',
    lastDeliveryDetail: 'Posted as @downtowntransit',
  },
}

const PARAMS = Promise.resolve({ connectorId: X })

async function renderSettled(ui: ReactElement) {
  await act(async () => {
    renderWithProviders(<Suspense fallback={<p>Loading this connector.</p>}>{ui}</Suspense>)
  })
}

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({ connectors: [CONFIGURED], connectorTypes: [A_TYPE] })
})

afterEach(() => resetStores())

describe('the connectors screens with no backend behind them', () => {
  it('opens the connector a channel row links to, rather than denying it exists', async () => {
    await renderSettled(<ConnectorEditPage params={PARAMS} />)

    expect(await screen.findByRole('heading', { name: 'Agency X account' })).toBeInTheDocument()
    expect(screen.queryByText('Connector not found.')).not.toBeInTheDocument()
  })

  it('lists what this deployment holds instead of reporting none', async () => {
    renderWithProviders(<ConnectorsPage />)

    expect(await screen.findByRole('link', { name: /Agency X account/ })).toHaveAttribute(
      'href',
      `/connectors/${X}`
    )
    expect(screen.queryByText(/No connectors configured/)).not.toBeInTheDocument()
  })

  it('offers the installed connectors to add rather than claiming none are installed', async () => {
    useMockDataStore.setState({ connectors: [] })
    renderWithProviders(<NewConnectorPage />)

    expect(await screen.findByRole('button', { name: 'X (agency account)' })).toBeInTheDocument()
    expect(screen.queryByText(/installs no channel connectors/)).not.toBeInTheDocument()
  })

  it('still says so for a connector this deployment does not hold', async () => {
    useMockDataStore.setState({ connectors: [] })
    await renderSettled(<ConnectorEditPage params={PARAMS} />)

    expect(await screen.findByText('Connector not found.')).toBeInTheDocument()
  })
})
