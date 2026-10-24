import type { MockQuery, MockVisualization, QueryResultData } from '@/lib/mock-data'
import { resolveParameterValues } from '@/lib/parameters/dynamic-dates'
import * as queriesService from '@/services/redash/queries'
import { executeSavedQuery } from '@/services/redash/execution'
import { NOT_AVAILABLE, pickVisualization } from './library-results'
import type { SavedRunSpec } from './run-spec'
import { shapeResult } from './shape-result'
import type { ChatQueryResult } from './tool-results'

export type { RunSpec, SavedRunSpec } from './run-spec'

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

export async function runSavedQuery(spec: SavedRunSpec, signal: AbortSignal): Promise<RunOutcome> {
  const query = await queriesService.get(spec.queryId)
  if (!query || query.is_archived) throw new Error(NOT_AVAILABLE)
  const result = await executeSavedQuery(spec.queryId, {
    parameters: resolveParameterValues(
      query.options?.parameters ?? [],
      mergedParameters(query, spec.parameters),
      new Date()
    ),
    maxAge: 0,
    signal,
  })
  const picked = pickVisualization(query, spec.visualizationId)
  return {
    data: result.data,
    dataSourceId: query.data_source_id,
    visualization: typeof picked === 'string' ? null : picked,
  }
}

export function savedRunResult(outcome: RunOutcome, queryId: number, notice?: string): ChatQueryResult {
  return {
    ...shapeResult(outcome.data, outcome.dataSourceId),
    savedQueryId: queryId,
    ...(notice ? { notice } : {}),
  }
}
