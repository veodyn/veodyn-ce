'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import type { CallView } from '@/lib/chat/thread-model'
import { hasParameters, pickVisualization } from '@/lib/chat/library-results'
import type { MockQuery, MockVisualization, QueryResultData } from '@/lib/mock-data'
import { readQueryError } from '@/lib/query-error'
import { executeSavedQuery } from '@/services/redash/execution'
import { useQueryById } from './use-queries'
import { useQueryResult } from './use-query-execution'

export interface SavedVisualization {
  query: MockQuery | null
  visualization: MockVisualization | null
  data: QueryResultData | null
  retrievedAt: string | null
  loading: boolean
  canRun: boolean
  running: boolean
  runError: string | null
  run: () => void
}

function wantedVisualization(call: CallView): number | null {
  const output = call.output
  if (output?.kind === 'saved_visualization' && output.visualization) return output.visualization.id
  return call.target?.visualizationId ?? null
}

export function useSavedVisualization(call: CallView): SavedVisualization {
  const queryId = call.target?.queryId
  const queryClient = useQueryClient()
  const saved = useQueryById(queryId)
  const query = saved.data ?? null
  const stored = useQueryResult(query?.latest_query_data_id)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const picked = query ? pickVisualization(query, wantedVisualization(call)) : null
  const visualization = picked && typeof picked !== 'string' ? picked : null
  const canRun = query !== null && !hasParameters(query)

  const run = useCallback(() => {
    if (!query || hasParameters(query)) return
    setRunning(true)
    setRunError(null)
    executeSavedQuery(query.id, { maxAge: 0 })
      .then((result) => {
        queryClient.setQueryData(['query-result', result.id], result)
        queryClient.setQueryData<MockQuery | null>(['query', query.id], (current) =>
          current ? { ...current, latest_query_data_id: result.id } : current
        )
      })
      .catch((error: unknown) => setRunError(readQueryError(error).message))
      .finally(() => setRunning(false))
  }, [query, queryClient])

  return {
    query,
    visualization,
    data: stored.data?.data ?? null,
    retrievedAt: stored.data?.retrieved_at ?? null,
    loading: saved.isLoading || stored.isLoading,
    canRun,
    running,
    runError,
    run,
  }
}
