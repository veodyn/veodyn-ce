'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { mockDestinationTypes } from '@/lib/mock-data'
import { USE_REAL_API } from '@/services/redash/config'
import * as destinationsService from '@/services/redash/destinations'
import type { DestinationUpdate } from '@/services/redash/destinations'
import type { MockDestination, MockDestinationType } from '@/lib/mock-data'
import { required } from '@/lib/required'

export function useDestinations() {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['destinations'],
    queryFn: () => {
      if (USE_REAL_API) {
        return destinationsService.list()
      }
      return store.destinations
    },
  })
}

/**
 * One destination, with its `options`. The list endpoint does not carry them,
 * so this is the only read an edit form may be built on.
 */
export function useDestination(id: number | undefined) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['destination', id],
    queryFn: () => {
      if (USE_REAL_API) {
        return destinationsService.get(required(id, 'the destination id'))
      }
      return store.destinations.find((d) => d.id === id) ?? null
    },
    enabled: id !== undefined,
  })
}

export function useDestinationTypes() {
  return useQuery({
    queryKey: ['destination-types'],
    queryFn: () => {
      if (USE_REAL_API) {
        return destinationsService.listTypes() as Promise<MockDestinationType[]>
      }
      return mockDestinationTypes
    },
  })
}

export function useCreateDestination() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: Omit<MockDestination, 'id' | 'created_at'>) => {
      if (USE_REAL_API) {
        return destinationsService.create({
          name: data.name,
          type: data.type,
          options: data.options,
        })
      }
      const id = store.nextId('destinations')
      const dest: MockDestination = {
        ...data,
        id,
        created_at: new Date().toISOString(),
      }
      store.addDestination(dest)
      return dest
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['destinations'] }),
  })
}

export function useUpdateDestination() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    // A whole destination, not a patch: Redash replaces name, type and options
    // from the body and reads all three unconditionally.
    mutationFn: async ({ id, ...updates }: DestinationUpdate & { id: number }) => {
      if (USE_REAL_API) {
        return destinationsService.update(id, updates)
      }
      store.updateDestination(id, updates)
      return required(
        useMockDataStore.getState().destinations.find((d) => d.id === id),
        'the updated destination'
      )
    },
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['destinations'] })
      qc.invalidateQueries({ queryKey: ['destination', id] })
    },
  })
}

export function useDeleteDestination() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return destinationsService.remove(id)
      }
      store.deleteDestination(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['destinations'] }),
  })
}
