'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as snippetsService from '@/services/redash/snippets'
import type { MockQuerySnippet } from '@/lib/mock-data'

export function useQuerySnippets() {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['query-snippets'],
    queryFn: () => {
      if (USE_REAL_API) {
        return snippetsService.list()
      }
      return store.querySnippets
    },
  })
}

export function useCreateSnippet() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: Omit<MockQuerySnippet, 'id' | 'user' | 'created_at' | 'updated_at'>) => {
      if (USE_REAL_API) {
        return snippetsService.create(data)
      }
      const id = store.nextId('querySnippets')
      const now = new Date().toISOString()
      const snippet: MockQuerySnippet = {
        ...data,
        id,
        user: { id: 1, name: 'Admin User' },
        created_at: now,
        updated_at: now,
      }
      store.addQuerySnippet(snippet)
      return snippet
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['query-snippets'] }),
  })
}

export function useUpdateSnippet() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MockQuerySnippet> & { id: number }) => {
      if (USE_REAL_API) {
        await snippetsService.update(id, updates)
        return
      }
      store.updateQuerySnippet(id, { ...updates, updated_at: new Date().toISOString() })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['query-snippets'] }),
  })
}

export function useDeleteSnippet() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return snippetsService.remove(id)
      }
      store.deleteQuerySnippet(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['query-snippets'] }),
  })
}
