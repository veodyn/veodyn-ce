'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { USE_REAL_API } from '@/services/redash/config'
import { withFixtureFallback } from '@/lib/backend-fallback'
import { useMockDataStore } from '@/stores/mock-data-store'
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

function keyThatFollowsTheStore(key: readonly unknown[], rows: unknown[]): unknown[] {
  return USE_REAL_API ? [...key] : [...key, rows]
}

export function useConnectorTypes() {
  const types = useMockDataStore((s) => s.connectorTypes)
  return useQuery({
    queryKey: keyThatFollowsTheStore(TYPES_KEY, types),
    queryFn: async ({ signal }): Promise<ConnectorType[]> =>
      USE_REAL_API
        ? withFixtureFallback(() => fetchConnectorTypes({ signal }), () => types)
        : types,
  })
}

export function useConnectors() {
  const connectors = useMockDataStore((s) => s.connectors)
  return useQuery({
    queryKey: keyThatFollowsTheStore(LIST_KEY, connectors),
    queryFn: async ({ signal }): Promise<Connector[]> =>
      USE_REAL_API
        ? withFixtureFallback(() => fetchConnectors({ signal }), () => connectors)
        : connectors,
  })
}

export function useConnector(connectorId: string | undefined) {
  const connectors = useMockDataStore((s) => s.connectors)
  return useQuery({
    queryKey: keyThatFollowsTheStore(connectorKey(connectorId ?? ''), connectors),
    enabled: connectorId != null,
    queryFn: async ({ signal }): Promise<Connector | null> => {
      const fixture = () => connectors.find((c) => c.connectorId === connectorId) ?? null
      if (!USE_REAL_API) return fixture()
      return withFixtureFallback(() => fetchConnector(connectorId as string, { signal }), fixture)
    },
  })
}

export function useCreateConnector() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (input: ConnectorInput) =>
      USE_REAL_API ? createConnector(input) : store.createConnector(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}

export function useUpdateConnector() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (vars: { connectorId: string; input: ConnectorUpdate }) =>
      USE_REAL_API
        ? updateConnector(vars.connectorId, vars.input)
        : store.updateConnector(vars.connectorId, vars.input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LIST_KEY })
      qc.invalidateQueries({ queryKey: connectorKey(vars.connectorId) })
    },
  })
}

export function useDeleteConnector() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (connectorId: string) =>
      USE_REAL_API ? deleteConnector(connectorId) : store.deleteConnector(connectorId),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  })
}
