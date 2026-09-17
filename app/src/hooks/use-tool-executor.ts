'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatToolRequest } from '@/lib/chat/frames'
import { failedResult, shapeResult } from '@/lib/chat/shape-result'
import type { QueryResultData } from '@/lib/mock-data'
import { readQueryError } from '@/lib/query-error'
import { postToolResult } from '@/services/ai/chat-client'
import { executeAdhoc } from '@/services/redash/execution'

export interface ToolExecutor {
  results: Record<string, QueryResultData>
  errors: Record<string, string>
  execute: (turnId: string, request: ChatToolRequest) => void
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

  const execute = useCallback(
    (turnId: string, request: ChatToolRequest) => {
      if (started.current.has(request.callId)) return
      started.current.add(request.callId)
      void run(request.callId, request.args.sql, request.args.dataSourceId)
        .then((outcome) => {
          if (outcome.aborted) return undefined
          const result = 'data' in outcome && outcome.data ? shapeResult(outcome.data) : failedResult(outcome.error)
          return postToolResult(turnId, request.callId, result)
        })
        .catch(() => undefined)
    },
    [run]
  )

  const rerun = useCallback(
    (callId: string, sql: string, dataSourceId: number) => {
      void run(callId, sql, dataSourceId)
    },
    [run]
  )

  return { results, errors, execute, rerun }
}
