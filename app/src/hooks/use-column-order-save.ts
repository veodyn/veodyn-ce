'use client'

import { useToast } from '@/components/shared/toast-provider'
import { useUpdateVisualization } from '@/hooks/use-visualizations'
import type { MockVisualization } from '@/lib/mock-data'
import type { RedashTableColumnOptions } from '@/services/redash/types'

export function useColumnOrderSave(queryId?: number) {
  const updateViz = useUpdateVisualization()
  const toast = useToast()

  return (viz: MockVisualization) => (columns: RedashTableColumnOptions[]) => {
    if (!queryId) return
    updateViz.mutate(
      {
        queryId,
        vizId: viz.id,
        type: viz.type,
        name: viz.name,
        options: { ...(viz.options ?? {}), columns },
      },
      {
        onError: () => toast.error(`Could not save ${viz.name}. The column order is unchanged.`),
      }
    )
  }
}
