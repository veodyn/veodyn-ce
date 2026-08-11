'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { useMockDataStore } from '@/stores/mock-data-store'
import { USE_REAL_API } from '@/services/redash/config'
import * as execution from '@/services/redash/execution'
import { cancelJob } from '@/services/redash/jobs'

// The in-flight execution, shared between useExecuteQuery and useCancelQuery
// so cancel keeps its historical zero-argument signature.
let currentExecution: { jobId: string | null; controller: AbortController } | null = null

export function useQueryResult(queryDataId: number | null | undefined) {
  const store = useMockDataStore()
  return useQuery({
    queryKey: ['query-result', queryDataId],
    queryFn: () => {
      if (!queryDataId) return null
      if (USE_REAL_API) {
        return execution.getResult(queryDataId)
      }
      return store.queryResults[queryDataId] ?? null
    },
    enabled: queryDataId != null,
  })
}

export function useExecuteQuery() {
  const store = useMockDataStore()
  return useMutation({
    mutationFn: async ({
      queryId,
      queryText,
      dataSourceId,
      parameters,
      savedQuery = false,
    }: {
      queryId?: number
      queryText: string
      dataSourceId: number
      parameters?: Record<string, unknown>
      /**
       * Run the stored query rather than the text passed here. Only correct
       * where the two cannot differ (the query view, not the editor), and it
       * matters for parameters: the ad hoc endpoint builds its
       * ParameterizedQuery with no schema, so a multi-value list is joined with
       * a bare "," and no quoting. The saved-query endpoint uses
       * `query.parameterized`, which carries the schema, so the parameter's own
       * multiValuesOptions are applied. Pre-joining on the client is not an
       * option: that endpoint validates enum values against the option list and
       * would reject the joined string.
       */
      savedQuery?: boolean
    }) => {
      if (USE_REAL_API) {
        const controller = new AbortController()
        const exec: typeof currentExecution = { jobId: null, controller }
        currentExecution = exec
        const onJob = (jobId: string) => {
          exec.jobId = jobId
        }
        try {
          if (savedQuery && queryId) {
            // max_age 0 because every caller of this branch is an explicit run.
            // Omitting it means "any cached result will do", which would make a
            // Refresh return the rows it was pressed to replace.
            return await execution.executeSavedQuery(queryId, {
              parameters,
              maxAge: 0,
              signal: controller.signal,
              onJob,
            })
          }
          // Otherwise execute the current buffer adhoc: it may differ from the
          // saved query text (same semantic as Redash's own editor).
          return await execution.executeAdhoc(dataSourceId, queryText, {
            parameters,
            signal: controller.signal,
            onJob,
          })
        } finally {
          if (currentExecution === exec) currentExecution = null
        }
      }

      // Simulate execution delay
      await new Promise((resolve) => setTimeout(resolve, 800 + Math.random() * 1200))

      // Check if we have mock results for this query
      if (queryId) {
        const query = store.queries.find((q) => q.id === queryId)
        if (query?.latest_query_data_id) {
          const result = store.queryResults[query.latest_query_data_id]
          if (result) return result
        }
      }

      // Generate generic mock result
      return {
        id: Date.now(),
        query_hash: `hash_${Date.now()}`,
        query: queryText,
        data: {
          columns: [
            { name: 'result', friendly_name: 'result', type: 'string' },
          ],
          rows: [{ result: 'Query executed successfully (mock)' }],
        },
        data_source_id: dataSourceId,
        runtime: Math.random() * 2,
        retrieved_at: new Date().toISOString(),
      }
    },
  })
}

export function useCancelQuery() {
  return useMutation({
    mutationFn: async () => {
      if (USE_REAL_API) {
        const exec = currentExecution
        if (exec?.jobId) {
          await cancelJob(exec.jobId).catch(() => {})
        }
        exec?.controller.abort()
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    },
  })
}

export function useFormatQuery() {
  return useMutation({
    mutationFn: async (queryText: string) => {
      if (USE_REAL_API) {
        return execution.formatQuery(queryText)
      }
      // Simple mock formatting - just uppercase keywords
      const keywords = [
        'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
        'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'GROUP BY', 'ORDER BY',
        'HAVING', 'LIMIT', 'OFFSET', 'AS', 'DISTINCT', 'COUNT', 'SUM',
        'AVG', 'MAX', 'MIN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
        'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE',
        'INDEX', 'UNION', 'ALL', 'WITH', 'BETWEEN', 'LIKE', 'IS', 'NULL',
      ]
      let formatted = queryText
      for (const kw of keywords) {
        formatted = formatted.replace(
          new RegExp(`\\b${kw}\\b`, 'gi'),
          kw.toUpperCase()
        )
      }
      return formatted
    },
  })
}
