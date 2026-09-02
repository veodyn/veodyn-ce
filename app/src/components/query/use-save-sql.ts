import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useCreateQuery, useUpdateQuery } from '@/hooks/use-queries'
import { useConfig } from '@/components/config/config-provider'
import type { useEditorParameters } from './use-editor-parameters'

interface UseSaveSqlOptions {
  queryId?: number
  existingQuery: { id: number } | undefined
  dataSourceId: number
  parameters: ReturnType<typeof useEditorParameters>['parameters']
  setIsDirty: (dirty: boolean) => void
}

export function useSaveSql({ queryId, existingQuery, dataSourceId, parameters, setIsDirty }: UseSaveSqlOptions) {
  const router = useRouter()
  const createQuery = useCreateQuery()
  const updateQuery = useUpdateQuery()
  const draftsEnabled = useConfig().features.query_drafts

  const saveSql = useCallback(
    async (sql: string) => {
      const share = draftsEnabled ? {} : { is_draft: false }
      const options = { parameters }
      if (queryId && existingQuery) {
        await updateQuery.mutateAsync({
          id: queryId,
          query: sql,
          data_source_id: dataSourceId,
          options,
          ...share,
        })
        setIsDirty(false)
      } else {
        const newQuery = await createQuery.mutateAsync({
          query: sql,
          data_source_id: dataSourceId,
          options,
          ...share,
        })
        router.push(`/queries/${newQuery.id}/source`)
      }
    },
    [queryId, existingQuery, dataSourceId, draftsEnabled, updateQuery, createQuery, router, setIsDirty, parameters]
  )

  return { saveSql, isSaving: updateQuery.isPending || createQuery.isPending }
}
