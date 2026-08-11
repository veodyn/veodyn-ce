'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as annotationsService from '@/services/redash/annotations'
import type { Annotation } from '@/types/annotation'

export function useAnnotations(dashboardId: number) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['annotations', dashboardId],
    queryFn: () => {
      if (USE_REAL_API) {
        return annotationsService.list(dashboardId)
      }
      return store.annotations.filter((a) => a.dashboard_id === dashboardId)
    },
  })
}

export function useCreateAnnotation() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (data: Omit<Annotation, 'id' | 'created_at'>) => {
      if (USE_REAL_API) {
        return annotationsService.create(data)
      }
      const id = store.nextId('annotations')
      const annotation: Annotation = {
        ...data,
        id,
        created_at: new Date().toISOString(),
      }
      store.addAnnotation(annotation)
      return annotation
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['annotations', vars.dashboard_id] })
    },
  })
}

export function useDeleteAnnotation() {
  const qc = useQueryClient()
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async (id: number) => {
      if (USE_REAL_API) {
        return annotationsService.remove(id)
      }
      store.deleteAnnotation(id)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['annotations'] }),
  })
}
