'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import {
  createConnector,
  deleteConnector,
  fetchConnector,
  fetchConnectorTypes,
  fetchConnectors,
  updateConnector,
} from '@/services/connectors/client'
import type { Connector, ConnectorInput, ConnectorType, ConnectorUpdate } from '@/types/connector'

const LIST_KEY = ['connectors']
const TYPES_KEY = ['connectors', 'types']
const connectorKey = (connectorId: string) => ['connectors', connectorId]

const NO_CONNECTOR_INSTALLED: ConnectorType[] = []
const NOTHING_CONFIGURED: Connector[] = []

export function useConnectorTypes() {
  return useQuery({
    queryKey: TYPES_KEY,
    queryFn: async ({ signal }): Promise<ConnectorType[]> =>
      USE_REAL_API
        ? withFixtureFallback(() => fetchConnectorTypes({ signal }), () => NO_CONNECTOR_INSTALLED)
        : NO_CONNECTOR_INSTALLED,
  })
}

export function useConnectors() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: async ({ signal }): Promise<Connector[]> =>
      USE_REAL_API
        ? withFixtureFallback(() => fetchConnectors({ signal }), () => NOTHING_CONFIGURED)
        : NOTHING_CONFIGURED,
  })
}

export function useConnector(connectorId: string | undefined) {
  return useQuery({
    queryKey: connectorKey(connectorId ?? ''),
    enabled: connectorId != null,
    queryFn: async ({ signal }): Promise<Connector | null> => {
      if (!USE_REAL_API) return null
      return withFixtureFallback(() => fetchConnector(connectorId as string, { signal }), () => null)
    },
  })
}

export function useCreateConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: ConnectorInput) => createConnector(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export function useUpdateConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { connectorId: string; input: ConnectorUpdate }) =>
      updateConnector(vars.connectorId, vars.input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      qc.invalidateQueries({ queryKey: connectorKey(vars.connectorId) })
    },
  })
}

export function useDeleteConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (connectorId: string) => deleteConnector(connectorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}
