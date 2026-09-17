import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import ConnectorsPage from '@/app/connectors/page'
import type { Connector } from '@/types/connector'

vi.mock('@/services/redash/config', () => ({ USE_REAL_API: true }))

const AWKWARD_ID = 'legacy crier/v2?x=1'

const configured: Connector[] = [
  {
    connectorId: AWKWARD_ID,
    displayName: AWKWARD_ID,
    name: 'Legacy crier',
    recallable: false,
    configuredFields: ['crier_token'],
    health: {
      delivery: 'untested',
      credentialsVerifiedAt: '2026-08-28T10:00:00Z',
      lastDeliveryAt: null,
      lastDeliveryDetail: null,
    },
  },
]

beforeEach(() => {
  server.use(http.get('/api/connectors', () => HttpResponse.json(configured)))
})

afterEach(() => resetStores())

describe('the connectors list', () => {
  it('encodes a stored connector id into the link rather than pasting it into the path', async () => {
    renderWithProviders(<ConnectorsPage />)

    const link = await screen.findByRole('link', { name: /Legacy crier/ })

    expect(link).toHaveAttribute('href', `/connectors/${encodeURIComponent(AWKWARD_ID)}`)
    expect(link.getAttribute('href')).not.toContain('?')
  })
})
