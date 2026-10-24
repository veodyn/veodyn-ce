'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { MapProvidersContext, type ReadinessContext } from '@veodyn/viz'
import { chatVisualization } from '@/components/chat/result-view'
import { isContributedRequest, runContributedTool, type ContributedToolRequest } from '@/features/chat-tools'
import { readinessNotice } from '@/lib/chat/readiness'
import type { ChatToolRequest, ChatToolRequestOf } from '@/lib/chat/frames'
import { runLibraryTool, type LibraryToolRequest } from '@/lib/chat/library-tools'
import {
  runSavedQuery,
  savedRunResult,
  type RunOutcome,
  type RunSpec,
  type SavedRunSpec,
} from '@/lib/chat/saved-query-run'
import { shapeResult } from '@/lib/chat/shape-result'
import { failedResult, type ChatToolResult } from '@/lib/chat/tool-results'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import { readQueryError } from '@/lib/query-error'
import { postToolResult } from '@/services/ai/chat-client'
import { executeAdhoc } from '@/services/redash/execution'

export type ResultSink = (callId: string, result: ChatToolResult) => void

export interface ToolExecutor {
  results: Record<string, QueryResultData>
  errors: Record<string, string>
  visualizations: Record<string, MockVisualization | null>
  execute: (turnId: string, request: ChatToolRequest, onResult: ResultSink) => void
  rerun: (callId: string, spec: RunSpec) => void
}

type Outcome = { aborted: true } | { aborted: false; run: RunOutcome } | { aborted: false; error: Error }

function without<T>(values: Record<string, T>, key: string): Record<string, T> {
  if (!(key in values)) return values
  const next = { ...values }
  delete next[key]
  return next
}

async function perform(spec: RunSpec, signal: AbortSignal): Promise<RunOutcome> {
  if (spec.kind === 'saved') return runSavedQuery(spec, signal)
  const result = await executeAdhoc(spec.dataSourceId, spec.sql, { applyAutoLimit: true, signal })
  return { data: result.data, dataSourceId: spec.dataSourceId, visualization: null }
}

function noticeFor(spec: RunSpec, run: RunOutcome, context: ReadinessContext): string | undefined {
  if (spec.kind === 'saved') {
    return run.visualization
      ? readinessNotice(run.visualization.type, run.visualization.options, context)
      : undefined
  }
  if (!spec.vizChoiceId) return undefined
  const drawn = chatVisualization(spec.vizChoiceId, run.data)
  return readinessNotice(drawn.type, drawn.options, context)
}

function resultFor(spec: RunSpec, run: RunOutcome, context: ReadinessContext): ChatToolResult {
  const notice = noticeFor(spec, run, context)
  if (spec.kind === 'saved') return savedRunResult(run, spec.queryId, notice)
  return { ...shapeResult(run.data, run.dataSourceId), ...(notice ? { notice } : {}) }
}

function savedSpec(request: ChatToolRequestOf<'run_saved_query'>): RunSpec {
  const spec: SavedRunSpec = {
    queryId: request.args.queryId,
    parameters: request.args.parameters,
    visualizationId: request.args.visualizationId,
  }
  return { kind: 'saved', ...spec }
}

export function useToolExecutor(): ToolExecutor {
  const [results, setResults] = useState<Record<string, QueryResultData>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [visualizations, setVisualizations] = useState<Record<string, MockVisualization | null>>({})
  const started = useRef(new Set<string>())
  const controllers = useRef(new Set<AbortController>())
  const mapProviders = useContext(MapProvidersContext)

  useEffect(() => {
    const live = controllers.current
    return () => {
      for (const controller of live) controller.abort()
      live.clear()
    }
  }, [])

  const run = useCallback(async (callId: string, spec: RunSpec): Promise<Outcome> => {
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const outcome = await perform(spec, controller.signal)
      if (controller.signal.aborted) return { aborted: true }
      setResults((current) => ({ ...current, [callId]: outcome.data }))
      setVisualizations((current) => ({ ...current, [callId]: outcome.visualization }))
      setErrors((current) => without(current, callId))
      return { aborted: false, run: outcome }
    } catch (error) {
      if (controller.signal.aborted) return { aborted: true }
      const message = readQueryError(error).message
      setErrors((current) => ({ ...current, [callId]: message }))
      return { aborted: false, error: new Error(message) }
    } finally {
      controllers.current.delete(controller)
    }
  }, [])

  const executeSpec = useCallback(
    (turnId: string, callId: string, spec: RunSpec) => {
      void run(callId, spec)
        .then((outcome) => {
          if (outcome.aborted) return undefined
          const result =
            'run' in outcome
              ? resultFor(spec, outcome.run, { mapProviders })
              : failedResult('query_result', outcome.error)
          return postToolResult(turnId, callId, result)
        })
        .catch(() => undefined)
    },
    [run, mapProviders]
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

  const executeContributed = useCallback((turnId: string, request: ContributedToolRequest, onResult: ResultSink) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    void runContributedTool(request, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return undefined
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
      if (request.tool === 'run_query') {
        const { sql, dataSourceId, vizChoiceId } = request.args
        executeSpec(turnId, request.callId, { kind: 'adhoc', sql, dataSourceId, vizChoiceId })
      } else if (request.tool === 'run_saved_query') executeSpec(turnId, request.callId, savedSpec(request))
      else if (isContributedRequest(request)) executeContributed(turnId, request, onResult)
      else executeLibrary(turnId, request, onResult)
    },
    [executeSpec, executeLibrary, executeContributed]
  )

  const rerun = useCallback(
    (callId: string, spec: RunSpec) => {
      void run(callId, spec)
    },
    [run]
  )

  return { results, errors, visualizations, execute, rerun }
}
