'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatToolRequest, ChatToolRequestOf } from '@/lib/chat/frames'
import { runLibraryTool, type LibraryToolRequest } from '@/lib/chat/library-tools'
import { shapeResult } from '@/lib/chat/shape-result'
import { failedResult, type ChatToolResult } from '@/lib/chat/tool-results'
import type { QueryResultData } from '@/lib/mock-data'
import { readQueryError } from '@/lib/query-error'
import { postToolResult } from '@/services/ai/chat-client'
import { executeAdhoc } from '@/services/redash/execution'

export type ResultSink = (callId: string, result: ChatToolResult) => void

export interface ToolExecutor {
  results: Record<string, QueryResultData>
  errors: Record<string, string>
  execute: (turnId: string, request: ChatToolRequest, onResult: ResultSink) => void
  rerun: (callId: string, sql: string, dataSourceId: number) => void
}

function without<T>(values: Record<string, T>, key: string): Record<string, T> {
  if (!(key in values)) return values
  const next = { ...values }
  delete next[key]
  return next
}

export function useToolExecutor(): ToolExecutor {
  const [results, setResults] = useState<Record<string, QueryResultData>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const started = useRef(new Set<string>())
  const controllers = useRef(new Set<AbortController>())

  useEffect(() => {
    const live = controllers.current
    return () => {
      for (const controller of live) controller.abort()
      live.clear()
    }
  }, [])

  const run = useCallback(async (callId: string, sql: string, dataSourceId: number) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const result = await executeAdhoc(dataSourceId, sql, { applyAutoLimit: true, signal: controller.signal })
      setResults((current) => ({ ...current, [callId]: result.data }))
      setErrors((current) => without(current, callId))
      return { data: result.data, aborted: false }
    } catch (error) {
      if (controller.signal.aborted) return { error, aborted: true }
      const message = readQueryError(error).message
      setErrors((current) => ({ ...current, [callId]: message }))
      return { error: new Error(message), aborted: false }
    } finally {
      controllers.current.delete(controller)
    }
  }, [])

  const executeQuery = useCallback(
    (turnId: string, request: ChatToolRequestOf<'run_query'>) => {
      void run(request.callId, request.args.sql, request.args.dataSourceId)
        .then((outcome) => {
          if (outcome.aborted) return undefined
          const result =
            'data' in outcome && outcome.data ? shapeResult(outcome.data) : failedResult('query_result', outcome.error)
          return postToolResult(turnId, request.callId, result)
        })
        .catch(() => undefined)
    },
    [run]
  )

  const executeLibrary = useCallback((turnId: string, request: LibraryToolRequest, onResult: ResultSink) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    void runLibraryTool(request, controller.signal)
      .then((result) => {
        onResult(request.callId, result)
        return postToolResult(turnId, request.callId, result)
      })
      .catch(() => undefined)
      .finally(() => controllers.current.delete(controller))
  }, [])

  const execute = useCallback(
    (turnId: string, request: ChatToolRequest, onResult: ResultSink) => {
      if (started.current.has(request.callId)) return
      started.current.add(request.callId)
      if (request.tool === 'run_query') executeQuery(turnId, request)
      else executeLibrary(turnId, request, onResult)
    },
    [executeQuery, executeLibrary]
  )

  const rerun = useCallback(
    (callId: string, sql: string, dataSourceId: number) => {
      void run(callId, sql, dataSourceId)
    },
    [run]
  )

  return { results, errors, execute, rerun }
}
