import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { alreadyConfigured, notConfigured } from '@/stores/connector-slice'
import { useMockDataStore } from '@/stores/mock-data-store'
import { resetStores } from '@/test/utils'
import type { Connector, ConnectorType } from '@/types/connector'

const TOWN_CRIER = 'town_crier'

const A_TYPE: ConnectorType = {
  connectorId: TOWN_CRIER,
  displayName: 'Town crier',
  recallable: true,
  credentialSchema: {
    properties: {
      crier_token: { type: 'string', title: 'Crier token' },
      crier_room: { type: 'string', title: 'Crier room' },
    },
    required: ['crier_token'],
    clearable: ['crier_room'],
    secret: ['crier_token'],
  },
  contentContract: {
    maxLength: 280,
    supportsMarkup: false,
    urlCountsAsCharacters: 23,
    requiredFooter: null,
  },
}

const DELIVERED: Connector = {
  connectorId: TOWN_CRIER,
  displayName: 'Town crier',
  name: 'The crier',
  recallable: true,
  configuredFields: ['crier_room', 'crier_token'],
  health: {
    delivery: 'delivering',
    credentialsVerifiedAt: '2026-08-20T09:00:00.000Z',
    lastDeliveryAt: '2026-08-26T17:42:00.000Z',
    lastDeliveryDetail: 'Cried in the square',
  },
}

function store() {
  return useMockDataStore.getState()
}

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({ connectors: [], connectorTypes: [A_TYPE] })
})

afterEach(() => resetStores())

describe('what mock mode does when a connector is configured', () => {
  it('records the credential names it was given, sorted, and calls the channel untested', () => {
    const created = store().createConnector({
      connectorId: TOWN_CRIER,
      name: 'The crier',
      credentials: { crier_token: 'tok', crier_room: 'square' },
    })

    expect(created.configuredFields).toEqual(['crier_room', 'crier_token'])
    expect(created.health.delivery).toBe('untested')
    expect(created.displayName).toBe('Town crier')
    expect(created.recallable).toBe(true)
    expect(store().connectors).toEqual([created])
  })

  it('refuses a second configuration for a connector that already holds credentials', () => {
    store().createConnector({ connectorId: TOWN_CRIER, name: 'The crier', credentials: { crier_token: 'tok' } })

    expect(() =>
      store().createConnector({ connectorId: TOWN_CRIER, name: 'Another', credentials: { crier_token: 'two' } })
    ).toThrow(alreadyConfigured(TOWN_CRIER))
    expect(store().connectors).toHaveLength(1)
  })

  it('refuses an id this build installs no connector for', () => {
    expect(() =>
      store().createConnector({ connectorId: 'nothing_here', name: 'Nope', credentials: {} })
    ).toThrow(/no connector 'nothing_here' is installed/)
  })

  it('merges a replace and a clear into the fields it reports as configured', () => {
    useMockDataStore.setState({ connectors: [DELIVERED] })

    const saved = store().updateConnector(TOWN_CRIER, {
      name: 'The crier',
      replace: { crier_token: 'rotated' },
      clear: ['crier_room'],
    })

    expect(saved.configuredFields).toEqual(['crier_token'])
  })

  it('keeps what the connector last delivered while moving the verification instant', () => {
    useMockDataStore.setState({ connectors: [DELIVERED] })

    const saved = store().updateConnector(TOWN_CRIER, { name: 'Renamed', replace: {}, clear: [] })

    expect(saved.name).toBe('Renamed')
    expect(saved.health.delivery).toBe('delivering')
    expect(saved.health.lastDeliveryDetail).toBe('Cried in the square')
    expect(saved.health.credentialsVerifiedAt).not.toBe(DELIVERED.health.credentialsVerifiedAt)
  })

  it('refuses to edit a connector that holds no credentials here', () => {
    expect(() => store().updateConnector(TOWN_CRIER, { name: 'x', replace: {}, clear: [] })).toThrow(
      notConfigured(TOWN_CRIER)
    )
  })

  it('forgets a connector the admin removed', () => {
    useMockDataStore.setState({ connectors: [DELIVERED] })

    store().deleteConnector(TOWN_CRIER)

    expect(store().connectors).toEqual([])
  })
})
