'use client'

import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { MapProvidersContext, validateVisualization } from '@veodyn/viz'
import { useOptionalConfig } from '@/components/config/config-provider'
import { isContributedRequest, runContributedTool, type ContributedToolRequest } from '@/features/chat-tools'
import { resolveKpiCheck, type DraftPreviewLookup } from '@/lib/chat/kpi-check'
import { browserSidecarTransport } from '@/lib/chat/sidecar-transport'
import { resolveSnippetCheck } from '@/lib/chat/snippet-check'
import { resolveDashboardEdit } from '@/lib/chat/dashboard-edit'
import type { AnyToolRequest, ChatToolRequestOf } from '@/lib/chat/frames'
import { runLibraryTool, type LibraryToolRequest } from '@/lib/chat/library-tools'
import { isOperationRequest, runOperationTool, type OperationToolRequest } from '@/lib/chat/operation-tools'
import { resolveQueryEdit } from '@/lib/chat/query-edit'
import { runErrorMessage } from '@/lib/chat/result-cap'
import type { RunOutcome, RunSpec } from '@/lib/chat/saved-query-run'
import { postToolResultSafely } from '@/lib/chat/post-result'
import { browserTransport } from '@/lib/chat/transport'
import { failedResult, type ChatToolResult, type OpenToolResult } from '@/lib/chat/tool-results'
import { resolveVizChange, runDescribeVizType } from '@/lib/chat/viz-tools'
import type { MockVisualization, QueryResultData } from '@/lib/mock-data'
import {
  isRegisteredType,
  isVizRequest,
  perform,
  resultFor,
  savedSpec,
  without,
  type VizRequest,
} from './tool-executor-run'

export type ResultSink = (callId: string, result: ChatToolResult | OpenToolResult) => void

export interface ToolExecutor {
  results: Record<string, QueryResultData>
  errors: Record<string, string>
  visualizations: Record<string, MockVisualization | null>
  execute: (turnId: string, request: AnyToolRequest, onResult: ResultSink) => void
  rerun: (callId: string, spec: RunSpec) => void
}

type Outcome = { aborted: true } | { aborted: false; run: RunOutcome } | { aborted: false; error: Error }

export function useToolExecutor(draftPreview?: DraftPreviewLookup): ToolExecutor {
  const [results, setResults] = useState<Record<string, QueryResultData>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [visualizations, setVisualizations] = useState<Record<string, MockVisualization | null>>({})
  const started = useRef(new Set<string>())
  const controllers = useRef(new Set<AbortController>())
  const mapProviders = useContext(MapProvidersContext)
  const queryDrafts = useOptionalConfig()?.features.query_drafts ?? false

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
      const message = runErrorMessage(error)
      setErrors((current) => ({ ...current, [callId]: message }))
      return { aborted: false, error: new Error(message) }
    } finally {
      controllers.current.delete(controller)
    }
  }, [])

  const executeSpec = useCallback(
    (turnId: string, callId: string, spec: RunSpec) => {
      const controller = new AbortController()
      controllers.current.add(controller)
      void run(callId, spec)
        .then(async (outcome) => {
          if (outcome.aborted) return undefined
          const result =
            'run' in outcome
              ? await resultFor(spec, outcome.run, { mapProviders }, controller.signal)
              : failedResult('query_result', outcome.error)
          if (controller.signal.aborted) return undefined
          return postToolResultSafely(turnId, callId, result)
        })
        .catch(() => undefined)
        .finally(() => controllers.current.delete(controller))
    },
    [run, mapProviders]
  )

  const executeResolved = useCallback(
    (turnId: string, callId: string, resolve: (signal: AbortSignal) => Promise<ChatToolResult | OpenToolResult>, onResult: ResultSink) => {
      const controller = new AbortController()
      controllers.current.add(controller)
      void resolve(controller.signal)
        .then((result) => {
          onResult(callId, result)
          return postToolResultSafely(turnId, callId, result)
        })
        .catch(() => undefined)
        .finally(() => controllers.current.delete(controller))
    },
    []
  )

  const executeLibrary = useCallback(
    (turnId: string, request: LibraryToolRequest, onResult: ResultSink) =>
      executeResolved(turnId, request.callId, (signal) => runLibraryTool(request, browserTransport, signal), onResult),
    [executeResolved]
  )

  const executeOperation = useCallback(
    (turnId: string, request: OperationToolRequest, onResult: ResultSink) =>
      executeResolved(turnId, request.callId, (signal) => runOperationTool(request, browserTransport, signal), onResult),
    [executeResolved]
  )

  const executeEdit = useCallback(
    (turnId: string, request: ChatToolRequestOf<'update_query'>, onResult: ResultSink) =>
      executeResolved(
        turnId,
        request.callId,
        (signal) => resolveQueryEdit(request, browserTransport, signal, { queryDrafts }),
        onResult
      ),
    [executeResolved, queryDrafts]
  )

  const executeDashboardEdit = useCallback(
    (turnId: string, request: ChatToolRequestOf<'update_dashboard'>, onResult: ResultSink) =>
      executeResolved(
        turnId,
        request.callId,
        (signal) => resolveDashboardEdit(request, browserTransport, signal),
        onResult
      ),
    [executeResolved]
  )

  const executeViz = useCallback(
    (turnId: string, request: VizRequest, onResult: ResultSink) =>
      executeResolved(
        turnId,
        request.callId,
        async (signal) =>
          request.tool === 'describe_visualization_type'
            ? runDescribeVizType(request)
            : resolveVizChange(request, browserTransport, signal, validateVisualization, isRegisteredType),
        onResult
      ),
    [executeResolved]
  )

  const executeContributed = useCallback((turnId: string, request: ContributedToolRequest, onResult: ResultSink) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    void runContributedTool(request, controller.signal, browserTransport, { sidecar: browserSidecarTransport })
      .then((result) => {
        if (controller.signal.aborted) return undefined
        onResult(request.callId, result)
        return postToolResultSafely(turnId, request.callId, result)
      })
      .catch(() => undefined)
      .finally(() => controllers.current.delete(controller))
  }, [])

  const executeContributedEdit = useCallback(
    (
      turnId: string,
      request: ChatToolRequestOf<'update_snippet' | 'delete_snippet' | 'propose_kpi'>,
      onResult: ResultSink
    ) =>
      executeResolved(
        turnId,
        request.callId,
        (signal) =>
          request.tool === 'propose_kpi'
            ? resolveKpiCheck(request, browserTransport, signal, draftPreview)
            : resolveSnippetCheck(request, browserTransport, signal),
        onResult
      ),
    [executeResolved, draftPreview]
  )

  const execute = useCallback(
    (turnId: string, request: AnyToolRequest, onResult: ResultSink) => {
      if (started.current.has(request.callId)) return
      started.current.add(request.callId)
      if (isContributedRequest(request)) {
        executeContributed(turnId, request, onResult)
        return
      }
      if (request.tool === 'run_query') {
        const { sql, dataSourceId, vizChoiceId } = request.args
        executeSpec(turnId, request.callId, { kind: 'adhoc', sql, dataSourceId, vizChoiceId })
      } else if (request.tool === 'run_saved_query') executeSpec(turnId, request.callId, savedSpec(request))
      else if (request.tool === 'update_query') executeEdit(turnId, request, onResult)
      else if (request.tool === 'update_dashboard') executeDashboardEdit(turnId, request, onResult)
      else if (
        request.tool === 'update_snippet' ||
        request.tool === 'delete_snippet' ||
        request.tool === 'propose_kpi'
      )
        executeContributedEdit(turnId, request, onResult)
      else if (isVizRequest(request)) executeViz(turnId, request, onResult)
      else if (isOperationRequest(request)) executeOperation(turnId, request, onResult)
      else executeLibrary(turnId, request, onResult)
    },
    [
      executeSpec,
      executeLibrary,
      executeEdit,
      executeDashboardEdit,
      executeViz,
      executeContributed,
      executeContributedEdit,
      executeOperation,
    ]
  )

  const rerun = useCallback(
    (callId: string, spec: RunSpec) => {
      void run(callId, spec)
    },
    [run]
  )

  return { results, errors, visualizations, execute, rerun }
}
