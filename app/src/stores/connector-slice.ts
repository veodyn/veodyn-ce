import type { StateCreator } from 'zustand'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { Connector, ConnectorInput, ConnectorType, ConnectorUpdate } from '@/types/connector'
import type { MockDataState } from './mock-data-store'

export interface ConnectorSlice {
  connectors: Connector[]
  connectorTypes: ConnectorType[]
  createConnector: (input: ConnectorInput) => Connector
  updateConnector: (connectorId: string, input: ConnectorUpdate) => Connector
  deleteConnector: (connectorId: string) => void
}

export function alreadyConfigured(connectorId: string): string {
  return (
    `'${connectorId}' already holds this organization's credentials; edit that configuration ` +
    'instead of adding a second one'
  )
}

export function notConfigured(connectorId: string): string {
  return `'${connectorId}' holds no credentials for this organization`
}

function refusal(reason: string): AppError {
  return new AppError(ErrorIds.CONNECTOR_REQUEST_FAILED, reason)
}

function fieldsAfter(kept: string[], replaced: string[]): string[] {
  return [...new Set([...kept, ...replaced])].sort()
}

export const createConnectorSlice: StateCreator<MockDataState, [], [], ConnectorSlice> = (
  set,
  get
) => ({
  connectors: [],
  connectorTypes: [],

  createConnector: (input) => {
    if (get().connectors.some((c) => c.connectorId === input.connectorId)) {
      throw refusal(alreadyConfigured(input.connectorId))
    }
    const type = get().connectorTypes.find((t) => t.connectorId === input.connectorId)
    if (type === undefined) {
      throw refusal(`no connector '${input.connectorId}' is installed in this deployment`)
    }
    const connector: Connector = {
      connectorId: input.connectorId,
      displayName: type.displayName,
      name: input.name,
      recallable: type.recallable,
      configuredFields: fieldsAfter([], Object.keys(input.credentials)),
      health: {
        delivery: 'untested',
        credentialsVerifiedAt: new Date().toISOString(),
        lastDeliveryAt: null,
        lastDeliveryDetail: null,
      },
    }
    set((s) => ({ connectors: [...s.connectors, connector] }))
    return connector
  },

  updateConnector: (connectorId, input) => {
    const existing = get().connectors.find((c) => c.connectorId === connectorId)
    if (existing === undefined) throw refusal(notConfigured(connectorId))
    const cleared = new Set(input.clear)
    const connector: Connector = {
      ...existing,
      name: input.name,
      configuredFields: fieldsAfter(
        existing.configuredFields.filter((name) => !cleared.has(name)),
        Object.keys(input.replace)
      ),
      health: { ...existing.health, credentialsVerifiedAt: new Date().toISOString() },
    }
    set((s) => ({
      connectors: s.connectors.map((c) => (c.connectorId === connectorId ? connector : c)),
    }))
    return connector
  },

  deleteConnector: (connectorId) =>
    set((s) => ({ connectors: s.connectors.filter((c) => c.connectorId !== connectorId) })),
})
