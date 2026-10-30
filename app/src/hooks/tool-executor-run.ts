import { getVisualization, type ReadinessContext } from '@veodyn/viz'
import { chatVisualization } from '@/components/chat/result-view'
import type { ChatToolRequest, ChatToolRequestOf } from '@/lib/chat/frames'
import { readinessNotice } from '@/lib/chat/readiness'
import {
  runAdhocQuery,
  runSavedQuery,
  withRunContext,
  type RunOutcome,
  type RunSpec,
  type SavedRunSpec,
} from '@/lib/chat/saved-query-run'
import { shapeResultOffThread } from '@/lib/chat/shape-result-off-thread'
import type { ChatToolResult } from '@/lib/chat/tool-results'
import { browserTransport } from '@/lib/chat/transport'

export function without<T>(values: Record<string, T>, key: string): Record<string, T> {
  if (!(key in values)) return values
  const next = { ...values }
  delete next[key]
  return next
}

export function perform(spec: RunSpec, signal: AbortSignal): Promise<RunOutcome> {
  if (spec.kind === 'saved') return runSavedQuery(spec, browserTransport, signal)
  return runAdhocQuery(spec, browserTransport, signal)
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

export async function resultFor(
  spec: RunSpec,
  run: RunOutcome,
  context: ReadinessContext,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const notice = noticeFor(spec, run, context)
  const shaped = await shapeResultOffThread(run.data, run.dataSourceId, signal)
  return withRunContext(shaped, spec.kind === 'saved' ? spec.queryId : undefined, notice)
}

export function isRegisteredType(type: string): boolean {
  return getVisualization(type) !== undefined
}

export type VizRequest = ChatToolRequestOf<
  'describe_visualization_type' | 'propose_visualization' | 'update_visualization' | 'delete_visualization'
>

export function isVizRequest(request: ChatToolRequest): request is VizRequest {
  return (
    request.tool === 'describe_visualization_type' ||
    request.tool === 'propose_visualization' ||
    request.tool === 'update_visualization' ||
    request.tool === 'delete_visualization'
  )
}

export function savedSpec(request: ChatToolRequestOf<'run_saved_query'>): RunSpec {
  const spec: SavedRunSpec = {
    queryId: request.args.queryId,
    parameters: request.args.parameters,
    visualizationId: request.args.visualizationId,
  }
  return { kind: 'saved', ...spec }
}
