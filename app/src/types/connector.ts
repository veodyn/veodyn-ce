import type { RedashConfigSchema } from '@/components/forms/schema-fields'

export interface ConnectorContentContract {
  maxLength: number | null
  supportsMarkup: boolean
  urlCountsAsCharacters: number | null
  requiredFooter: string | null
}

export interface ConnectorType {
  connectorId: string
  displayName: string
  recallable: boolean
  credentialSchema: RedashConfigSchema
  contentContract: ConnectorContentContract
}

export type ConnectorDelivery = 'untested' | 'delivering' | 'failing'

export interface ConnectorHealth {
  delivery: ConnectorDelivery
  credentialsVerifiedAt: string
  lastDeliveryAt: string | null
  lastDeliveryDetail: string | null
}

export interface Connector {
  connectorId: string
  displayName: string
  name: string
  recallable: boolean
  configuredFields: string[]
  health: ConnectorHealth
}

export interface ConnectorInput {
  connectorId: string
  name: string
  credentials: Record<string, unknown>
}

export interface ConnectorUpdate {
  name: string
  replace: Record<string, unknown>
  clear: string[]
}
