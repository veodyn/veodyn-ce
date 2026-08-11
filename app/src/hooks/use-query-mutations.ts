'use client'

// Everything that WRITES a query, split out of use-queries.ts when the read and
// write halves together outgrew the file size limit. Re-exported from
// use-queries.ts, which stays the single import path every call site already
// uses, so this seam is invisible to callers.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAuthStore } from '@/stores/auth-store'
import { mockOwner } from '@/lib/mock-owner'
import { USE_REAL_API } from '@/services/redash/config'
import * as queriesService from '@/services/redash/queries'
import type { MockQuery } from '@/lib/mock-data'
import { required } from '@/lib/required'
import { AppError, ErrorIds } from '@/lib/errorIds'

export function useCreateQuery() {
  const owner = mockOwner(useAuthStore((s) => s.currentUser))
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: Partial<MockQuery>) => {
      if (USE_REAL_API) {
        return queriesService.create(data)
      }
      const id = store.nextId('queries')
      const now = new Date().toISOString()
      const query: MockQuery = {
        id,
        name: data.name || 'New Query',
        description: data.description || '',
        query: data.query || '',
        data_source_id: data.data_source_id || 1,
        schedule: null,
        tags: data.tags || [],
        is_archived: false,
        // Honours what the caller asked for, defaulting to a draft the way
        // Redash does. Hardcoding true here made mock mode disagree with the
        // service layer, which does get a listed query out of a create.
        is_draft: data.is_draft ?? true,
        is_favorite: false,
        is_safe: true,
        can_edit: true,
        user: owner,
        last_modified_by: owner,
        visualizations: [
          { id: id * 100, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: now, updated_at: now },
        ],
        latest_query_data_id: null,
        // Honours what the caller sent, so a query saved straight out of the
        // editor keeps the parameters its SQL declares instead of losing them
        // until the next save.
        options: data.options ?? { parameters: [] },
        created_at: now,
        updated_at: now,
        retrieved_at: '',
        runtime: 0,
      }
      store.addQuery(query)
      return query
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries'] }),
  })
}

export function useUpdateQuery() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MockQuery> & { id: number }) => {
      if (USE_REAL_API) {
        return queriesService.update(id, updates)
      }
      store.updateQuery(id, { ...updates, updated_at: new Date().toISOString() })
      return required(
        useMockDataStore.getState().queries.find((q) => q.id === id),
        'the updated query'
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['queries'] })
      qc.invalidateQueries({ queryKey: ['query', vars.id] })
    },
  })
}

export function useArchiveQuery() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return queriesService.archive(id)
      }
      store.updateQuery(id, { is_archived: true })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries'] }),
  })
}

/**
 * Restore an archived query.
 *
 * There is no matching "delete permanently": Redash's DELETE on a query
 * archives it (QueryResource.delete calls query.archive), and it exposes no
 * hard-delete endpoint at all. Offering one here would mean a button that
 * cannot do what it says.
 */
export function useUnarchiveQuery() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return queriesService.unarchive(id)
      }
      store.updateQuery(id, { is_archived: false })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries'] }),
  })
}

/**
 * Rotate this query's API key, invalidating any URL built from the old one.
 *
 * The dialog's Regenerate button used to be wired to `() => {}` at both call
 * sites, so it rotated nothing. Redash does expose the endpoint
 * (QueryRegenerateApiKeyResource), so it is wired rather than removed.
 */
export function useRegenerateQueryApiKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return queriesService.regenerateApiKey(id)
      }
      // The fixtures mint no query keys, so there is nothing to rotate. Failing
      // loudly beats reporting a rotation that did not happen.
      throw new AppError(ErrorIds.QUERY_NOT_IN_MOCK, 'Query API keys are not issued in mock mode')
    },
    onSuccess: (query) => {
      if (query) qc.setQueryData(['query', query.id], query)
      qc.invalidateQueries({ queryKey: ['queries'] })
    },
  })
}

export function useForkQuery() {
  const owner = mockOwner(useAuthStore((s) => s.currentUser))
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return queriesService.fork(id)
      }
      const original = store.queries.find((q) => q.id === id)
      if (!original) throw new Error('Query not found')
      const newId = store.nextId('queries')
      const now = new Date().toISOString()
      const forked: MockQuery = {
        ...original,
        id: newId,
        name: `Copy of (#${id}) ${original.name}`,
        is_draft: true,
        is_favorite: false,
        schedule: null,
        user: owner,
        created_at: now,
        updated_at: now,
        visualizations: [
          { id: newId * 100, type: 'TABLE', name: 'Table', description: '', options: {}, created_at: now, updated_at: now },
        ],
      }
      store.addQuery(forked)
      return forked
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['queries'] }),
  })
}
