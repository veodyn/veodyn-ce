import type { MockQuery, MockVisualization, QueryResultData } from '@/lib/mock-data'
import { resolveParameterValues } from '@/lib/parameters/dynamic-dates'
import { NOT_AVAILABLE, pickVisualization } from './library-results'
import * as nodeCalls from './node-calls'
import { CHAT_RESULT_MAX_BYTES } from './result-cap'
import type { AdhocRunSpec, SavedRunSpec } from './run-spec'
import { shapeResult } from './shape-result'
import type { RedashTransport } from './transport'
import type { ChatQueryResult } from './tool-results'

export type { AdhocRunSpec, RunSpec, SavedRunSpec } from './run-spec'

export interface RunOutcome {
  data: QueryResultData
  dataSourceId: number
  visualization: MockVisualization | null
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined
}

export function mergedParameters(query: MockQuery, overrides: Record<string, unknown>): Record<string, unknown> {
  const defaults = Object.fromEntries(
    (query.options?.parameters ?? [])
      .filter((parameter) => isSet(parameter.value))
      .map((parameter) => [parameter.name, parameter.value])
  )
  return { ...defaults, ...overrides }
}

export async function runSavedQuery(
  spec: SavedRunSpec,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<RunOutcome> {
  const query = await nodeCalls.getQuery(transport, spec.queryId, signal)
  if (!query || query.is_archived) throw new Error(NOT_AVAILABLE)
  const result = await nodeCalls.executeSavedQuery(transport, spec.queryId, {
    parameters: resolveParameterValues(
      query.options?.parameters ?? [],
      mergedParameters(query, spec.parameters),
      new Date()
    ),
    maxAge: 0,
    maxResultBytes: CHAT_RESULT_MAX_BYTES,
    signal,
  })
  const picked = pickVisualization(query, spec.visualizationId)
  return {
    data: result.data,
    dataSourceId: query.data_source_id,
    visualization: typeof picked === 'string' ? null : picked,
  }
}

export async function runAdhocQuery(
  spec: AdhocRunSpec,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<RunOutcome> {
  const result = await nodeCalls.executeAdhoc(transport, spec.dataSourceId, spec.sql, {
    applyAutoLimit: true,
    maxResultBytes: CHAT_RESULT_MAX_BYTES,
    signal,
  })
  return { data: result.data, dataSourceId: spec.dataSourceId, visualization: null }
}

export function withRunContext(shaped: ChatQueryResult, savedQueryId?: number, notice?: string): ChatQueryResult {
  return {
    ...shaped,
    ...(savedQueryId === undefined ? {} : { savedQueryId }),
    ...(notice ? { notice } : {}),
  }
}

export function savedRunResult(outcome: RunOutcome, queryId: number, notice?: string): ChatQueryResult {
  return withRunContext(shapeResult(outcome.data, outcome.dataSourceId), queryId, notice)
}
