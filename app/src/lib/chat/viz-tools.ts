import {
  applyOptionOps,
  authoredColumnProblems,
  CORE_AUTHORING,
  authoringFor,
  describeAuthoring,
  sanitizeAuthored,
  type AuthoringSchema,
} from '@veodyn/viz/authoring'
import type { QueryResultData } from '@/lib/mock-data'
import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import type { RedashQuery, RedashVisualization } from '@/services/redash/types'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import * as nodeCalls from './node-calls'
import { fetchQuery, noQuery } from './query-detail'
import { CANNOT_EDIT, sameValue } from './query-edit'
import type { RedashTransport } from './transport'
import { failedResult, type ChatToolResult } from './tool-results'
import type { ChatVizCheckResult } from './tool-results-viz'
import { declaredDefaults } from './viz-options'

export const NO_STORED_RESULT_FOR_COLUMNS = 'Run the query first (run_saved_query) so its columns are known.'
export const CANNOT_DELETE_TABLE = 'The table visualization cannot be deleted.'
export const NOTHING_TO_CHANGE = 'That would not change the visualization.'
const TABLE_TYPE = 'TABLE'
const MAX_DESCRIBED_OPTIONS = 80
const MAX_PROBLEMS = 20

export type VizValidator = (type: string, options: Record<string, unknown>, data: QueryResultData) => string[]

type VizChangeRequest = ChatToolRequestOf<'propose_visualization' | 'update_visualization' | 'delete_visualization'>
type Options = Record<string, unknown>
type Snapshot = NonNullable<ChatVizCheckResult['snapshot']>

export function noVisualization(visualizationId: number, queryId: number): string {
  return `No visualization ${visualizationId} on query ${queryId}.`
}

const CHART_SHAPES = ['line', 'bar', 'area', 'pie', 'scatter']

export type TypeRegistered = (type: string) => boolean

export function noVisualizationType(type: string): string {
  const shape = type.toLowerCase()
  const hint = CHART_SHAPES.includes(shape)
    ? `A ${shape} chart is type CHART with set globalSeriesType = ${shape}.`
    : 'Line, bar, area, pie and scatter are type CHART with globalSeriesType set.'
  return `No visualization type "${type}". ${hint} Types: ${Object.keys(CORE_AUTHORING).join(', ')}.`
}

function knownType(type: string, registered: TypeRegistered | undefined): boolean {
  return Object.hasOwn(CORE_AUTHORING, type) || (registered?.(type) ?? false)
}

export function noOptions(type: string): string {
  return `The ${type} visualization declares no options, so it takes only its preset options.`
}

interface StoredResult {
  names: string[]
  data: QueryResultData
}

function failed(error: string): ChatToolResult {
  return failedResult('visualization_check', error)
}

export function runDescribeVizType(request: ChatToolRequestOf<'describe_visualization_type'>): ChatToolResult {
  const { type } = request.args
  const described = describeAuthoring(type)
  if (!described) return failedResult('visualization_type', noOptions(type))
  return {
    kind: 'visualization_type',
    ok: true,
    type: described.type,
    label: described.label,
    options: described.options.slice(0, MAX_DESCRIBED_OPTIONS) as unknown as Options[],
  }
}

async function storedResult(
  raw: RedashQuery,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<StoredResult | null> {
  if (raw.latest_query_data_id == null) return null
  const stored = await nodeCalls.getQueryResult(transport, raw.latest_query_data_id, signal)
  return { names: stored.data.columns.map((column) => column.name), data: stored.data }
}

function snapshotOf(viz: RedashVisualization): Snapshot {
  return { type: viz.type, name: viz.name, options: viz.options ?? {}, updatedAt: viz.updated_at }
}

function valueAt(root: unknown, segments: string[]): unknown {
  let node = root
  for (const segment of segments) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment)) return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node
}

function declaredOperations(
  schema: AuthoringSchema,
  set: { path: string; value?: unknown }[] | undefined
): { path: string; value: unknown }[] {
  const kept: { path: string; value: unknown }[] = []
  for (const { path, value } of set ?? []) {
    const probePath = path.split('.').map((segment) => (/^\d+$/.test(segment) ? '0' : segment))
    const probe = sanitizeAuthored(schema, applyOptionOps({}, { set: [{ path: probePath.join('.'), value }] }))
    const written = valueAt(probe, probePath)
    if (written !== undefined) kept.push({ path, value: written })
  }
  return kept
}

function problemsOf(
  type: string,
  schema: AuthoringSchema | null,
  options: Options,
  result: StoredResult | null,
  validate: VizValidator | undefined
): string[] {
  const columns = schema ? authoredColumnProblems(schema, options, result?.names ?? []) : []
  const typed = result && validate ? validate(type, options, result.data) : []
  return [...columns, ...typed]
}

async function checked(
  raw: RedashQuery,
  transport: RedashTransport,
  signal: AbortSignal,
  validate: VizValidator | undefined,
  next: { type: string; name: string; options: Options },
  before: Snapshot | null
): Promise<{ problems: string[] } | { error: string }> {
  const schema = authoringFor(next.type)
  const result = await storedResult(raw, transport, signal)
  const baseline = new Set(before && before.type === next.type ? problemsOf(next.type, schema, before.options, result, validate) : [])
  const problems = problemsOf(next.type, schema, next.options, result, validate).filter((one) => !baseline.has(one))
  if (!result && problems.length > 0) return { error: NO_STORED_RESULT_FOR_COLUMNS }
  return { problems: problems.slice(0, MAX_PROBLEMS) }
}

function proposed(
  request: ChatToolRequestOf<'propose_visualization'>,
  registered: TypeRegistered | undefined
): { type: string; name: string; options: Options } | string {
  const { type, name, options } = request.args
  if (!knownType(type, registered)) return noVisualizationType(type)
  const schema = authoringFor(type)
  if (!schema) return Object.keys(options).length > 0 ? noOptions(type) : { type, name, options: {} }
  return { type, name, options: sanitizeAuthored(schema, { ...declaredDefaults(schema), ...options }) }
}

function edited(
  request: ChatToolRequestOf<'update_visualization'>,
  snapshot: Snapshot,
  registered: TypeRegistered | undefined
): { type: string; name: string; options: Options } | string {
  const { type: requestedType, name, set, unset } = request.args
  const type = requestedType ?? snapshot.type
  const changedType = type !== snapshot.type
  if (changedType && !knownType(type, registered)) return noVisualizationType(type)
  const hasOperations = (set?.length ?? 0) + (unset?.length ?? 0) > 0
  const schema = authoringFor(type)
  if (!schema) {
    if (hasOperations) return noOptions(type)
    return { type, name: name ?? snapshot.name, options: changedType ? {} : snapshot.options }
  }
  if (changedType) {
    const applied = applyOptionOps(declaredDefaults(schema), { set: set?.map(({ path, value }) => ({ path, value })), unset })
    return { type, name: name ?? snapshot.name, options: sanitizeAuthored(schema, applied) }
  }
  const options = applyOptionOps(snapshot.options, { set: declaredOperations(schema, set), unset })
  return { type, name: name ?? snapshot.name, options }
}

function findVisualization(raw: RedashQuery, visualizationId: number): RedashVisualization | undefined {
  return (raw.visualizations ?? []).find((one) => one.id === visualizationId)
}

async function resolveNew(
  request: ChatToolRequestOf<'propose_visualization'>,
  raw: RedashQuery,
  transport: RedashTransport,
  signal: AbortSignal,
  validate: VizValidator | undefined,
  registered: TypeRegistered | undefined
): Promise<ChatToolResult> {
  const next = proposed(request, registered)
  if (typeof next === 'string') return failed(next)
  const verdict = await checked(raw, transport, signal, validate, next, null)
  if ('error' in verdict) return failed(verdict.error)
  return { kind: 'visualization_check', ok: true, mode: 'new', queryId: request.args.queryId, next, problems: verdict.problems }
}

async function resolveEdit(
  request: ChatToolRequestOf<'update_visualization'>,
  raw: RedashQuery,
  transport: RedashTransport,
  signal: AbortSignal,
  validate: VizValidator | undefined,
  registered: TypeRegistered | undefined
): Promise<ChatToolResult> {
  const { queryId, visualizationId } = request.args
  const viz = findVisualization(raw, visualizationId)
  if (!viz) return failed(noVisualization(visualizationId, queryId))
  const snapshot = snapshotOf(viz)
  const next = edited(request, snapshot, registered)
  if (typeof next === 'string') return failed(next)
  const unchanged =
    next.type === snapshot.type && next.name === snapshot.name && sameValue(next.options, snapshot.options)
  if (unchanged) return failed(NOTHING_TO_CHANGE)
  const verdict = await checked(raw, transport, signal, validate, next, snapshot)
  if ('error' in verdict) return failed(verdict.error)
  return { kind: 'visualization_check', ok: true, mode: 'edit', queryId, visualizationId, snapshot, next, problems: verdict.problems }
}

function resolveDelete(request: ChatToolRequestOf<'delete_visualization'>, raw: RedashQuery): ChatToolResult {
  const { queryId, visualizationId } = request.args
  const viz = findVisualization(raw, visualizationId)
  if (!viz) return failed(noVisualization(visualizationId, queryId))
  if (viz.type === TABLE_TYPE) return failed(CANNOT_DELETE_TABLE)
  return { kind: 'visualization_check', ok: true, mode: 'delete', queryId, visualizationId, snapshot: snapshotOf(viz), problems: [] }
}

async function dispatch(
  request: VizChangeRequest,
  transport: RedashTransport,
  signal: AbortSignal,
  validate: VizValidator | undefined,
  registered: TypeRegistered | undefined
): Promise<ChatToolResult> {
  const raw = await fetchQuery(transport, request.args.queryId, signal)
  if (!raw) return failed(noQuery(request.args.queryId))
  if (!raw.can_edit) return failed(CANNOT_EDIT)
  switch (request.tool) {
    case 'propose_visualization':
      return resolveNew(request, raw, transport, signal, validate, registered)
    case 'update_visualization':
      return resolveEdit(request, raw, transport, signal, validate, registered)
    case 'delete_visualization':
      return resolveDelete(request, raw)
  }
}

export async function resolveVizChange(
  request: VizChangeRequest,
  transport: RedashTransport,
  signal: AbortSignal,
  validate?: VizValidator,
  registered?: TypeRegistered
): Promise<ChatToolResult> {
  try {
    return await dispatch(request, transport, signal, validate, registered)
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && error.status === 403) return failed(NOT_AVAILABLE)
    return failed(readQueryError(error).message)
  }
}
