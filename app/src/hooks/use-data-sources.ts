'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockDataSourceTypes, mockSchema } from '@/lib/mock-data'
import { USE_REAL_API } from '@/services/redash/config'
import * as dataSourcesService from '@/services/redash/data-sources'
import type { MockDataSource, MockDataSourceType } from '@/lib/mock-data'
import { required } from '@/lib/required'

// The Redash list serializer omits options/groups; default them so the UI
// types (MockDataSource) stay intact. The detail endpoint fills them in.
function normalizeDataSource(raw: dataSourcesService.RedashDataSource): MockDataSource {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    syntax: raw.syntax ?? 'sql',
    paused: raw.paused ?? 0,
    pause_reason: raw.pause_reason ?? null,
    options: raw.options ?? {},
    groups: raw.groups ?? {},
    created_at: raw.created_at ?? '',
    view_only: raw.view_only ?? false,
  }
}

export function useDataSources() {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['data-sources'],
    queryFn: async () => {
      if (USE_REAL_API) {
        const list = await dataSourcesService.listDataSources()
        return list.map(normalizeDataSource)
      }
      return store.dataSources
    },
  })
}

export function useDataSource(id: number | undefined) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['data-source', id],
    queryFn: async () => {
      if (USE_REAL_API) {
        const ds = await dataSourcesService.getDataSource(required(id, 'the data source id'))
        return ds ? normalizeDataSource(ds) : null
      }
      return store.dataSources.find((ds) => ds.id === id) ?? null
    },
    enabled: id !== undefined,
  })
}

export function useDataSourceTypes() {
  return useQuery({
    queryKey: ['data-source-types'],
    queryFn: () => {
      if (USE_REAL_API) {
        // Redash's configuration_schema is the same JSON-Schema structure the
        // mock types declare (properties/order/required/secret)
        return dataSourcesService.listTypes() as Promise<MockDataSourceType[]>
      }
      return mockDataSourceTypes
    },
  })
}

export function useDataSourceSchema(id: number | undefined, refresh = false) {
  return useQuery({
    queryKey: ['data-source-schema', id, refresh],
    // A schema refresh can poll for up to 30s. Hand it the query's own signal so
    // leaving the page or switching data source stops the poll instead of
    // letting it run out.
    queryFn: ({ signal }) => {
      if (USE_REAL_API) {
        return dataSourcesService.getSchema(required(id, 'the data source id'), refresh, signal)
      }
      return mockSchema[required(id, 'the data source id')] ?? []
    },
    enabled: id !== undefined,
  })
}

export function useCreateDataSource() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: Omit<MockDataSource, 'id' | 'created_at'>) => {
      if (USE_REAL_API) {
        const created = await dataSourcesService.createDataSource({
          name: data.name,
          type: data.type,
          options: data.options,
        })
        return normalizeDataSource(created)
      }
      const id = store.nextId('dataSources')
      const ds: MockDataSource = {
        ...data,
        id,
        created_at: new Date().toISOString(),
      }
      store.addDataSource(ds)
      return ds
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data-sources'] }),
  })
}

export function useUpdateDataSource() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MockDataSource> & { id: number }) => {
      if (USE_REAL_API) {
        const updated = await dataSourcesService.updateDataSource(id, {
          name: updates.name,
          type: updates.type,
          options: updates.options,
        })
        return normalizeDataSource(updated)
      }
      store.updateDataSource(id, updates)
      return required(
        useMockDataStore.getState().dataSources.find((ds) => ds.id === id),
        'the updated data source'
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['data-sources'] })
      qc.invalidateQueries({ queryKey: ['data-source', vars.id] })
    },
  })
}

export function useDeleteDataSource() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return dataSourcesService.deleteDataSource(id)
      }
      store.deleteDataSource(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data-sources'] }),
  })
}

/**
 * Pause and resume. Both invalidate the list as well as the detail entry,
 * because a paused source has to read as paused wherever it is listed, not only
 * on the page the switch was thrown from.
 */
export function usePauseDataSource() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) => {
      if (USE_REAL_API) {
        return dataSourcesService.pauseDataSource(id, reason)
      }
      store.updateDataSource(id, { paused: 1, pause_reason: reason?.trim() || null })
      return null
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['data-sources'] })
      qc.invalidateQueries({ queryKey: ['data-source', vars.id] })
    },
  })
}

export function useResumeDataSource() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return dataSourcesService.resumeDataSource(id)
      }
      store.updateDataSource(id, { paused: 0, pause_reason: null })
      return null
    },
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['data-sources'] })
      qc.invalidateQueries({ queryKey: ['data-source', id] })
    },
  })
}

export function useTestConnection() {
  return useMutation({
    // Real mode needs the data source id; mock ignores it.
    mutationFn: async (id?: number) => {
      if (USE_REAL_API) {
        if (id === undefined) {
          return { ok: false, message: 'Save the data source before testing.' }
        }
        return dataSourcesService.testConnection(id)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return { ok: true, message: 'Connection successful (mock)' }
    },
  })
}
