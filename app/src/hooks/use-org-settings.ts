'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { redashApi } from '@/services/api-client'
import { USE_REAL_API } from '@/services/redash/config'

// Redash organization settings (GET/POST /api/settings/organization).
// The GET wraps values in {settings}; POST takes the flat key/value map.
export interface OrgSettings {
  date_format?: string
  time_format?: string
  integer_format?: string
  float_format?: string
  [key: string]: unknown
}

export function useOrgSettings() {
  return useQuery({
    queryKey: ['org-settings'],
    queryFn: async () => {
      // Mock mode has no backend to ask, so the cache is the whole store. It
      // starts empty and consumers fall back to their defaults; a save below
      // writes into it, so a format change is visible for the session. It does
      // not survive a reload, like every other write in mock mode.
      if (!USE_REAL_API) return {} as OrgSettings
      const res = await redashApi.get<{ settings: OrgSettings }>('settings/organization')
      return res.settings
    },
  })
}

export function useUpdateOrgSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (changes: OrgSettings) => {
      if (!USE_REAL_API) return changes
      const res = await redashApi.post<{ settings: OrgSettings }>(
        'settings/organization',
        changes
      )
      return res.settings
    },
    onSuccess: (settings) => {
      if (!USE_REAL_API) {
        // Nothing to refetch from, so seed the cache with what was saved.
        qc.setQueryData(['org-settings'], (current: OrgSettings | undefined) => ({
          ...current,
          ...settings,
        }))
        return
      }
      qc.invalidateQueries({ queryKey: ['org-settings'] })
    },
  })
}
