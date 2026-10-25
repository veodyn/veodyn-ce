import { calculateNewWidgetPosition, getDefaultSize } from '@/components/dashboard/add-widget-layout'
import type { MockDashboard, MockDashboardWidget } from '@/lib/mock-data'
import { readQueryError } from '@/lib/query-error'
import { ApiError } from '@/services/api-client'
import { normalizeDashboard } from '@/services/redash/normalize-dashboard'
import type { RedashQuery } from '@/services/redash/types'
import {
  GRID_COLUMNS,
  MAX_DASHBOARD_TAG_CHARS,
  MAX_DASHBOARD_TAGS,
  MAX_ROW_SPAN,
  MAX_SNAPSHOT_WIDGETS,
  type DashboardOperation,
  type DashboardSnapshot,
  type GridPosition,
} from './dashboard-changes'
import { resolveMappings } from './dashboard-edit-mappings'
import { getRawDashboard } from './dashboard-node-calls'
import { gridOf, textTitle, titleOfWidget, widgetTitle } from './dashboard-widgets'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import { fetchQuery } from './query-detail'
import { failedResult, type ChatToolResult } from './tool-results'
import type { RedashTransport } from './transport'

export const CANNOT_EDIT_DASHBOARD = 'You cannot edit this dashboard.'
export const TOO_MANY_WIDGETS = 'This dashboard has more widgets than chat can edit safely; edit it on the dashboard page.'
export const TOO_MANY_TAGS = 'This dashboard has tags chat cannot carry; change its tags on the dashboard page.'
export const DRAFT_WIDGET_TITLE = 'New chart'

const TEXT_SIZE = { sizeX: GRID_COLUMNS, sizeY: 4 }
const MAX_PROBLEMS = 20
const MAX_PROBLEM_CHARS = 500
const MAX_TITLE_CHARS = 500

type Request = ChatToolRequestOf<'update_dashboard'>
type RequestedOperation = NonNullable<Request['args']['operations']>[number]
type Position = DashboardOperation['position']

interface Resolution {
  operations: DashboardOperation[]
  problems: string[]
}

function failed(error: string): ChatToolResult {
  return failedResult('dashboard_edit', error)
}

function placed(position: GridPosition): Position {
  const col = Math.min(position.col, GRID_COLUMNS - 1)
  const sizeX = Math.min(Math.max(position.sizeX, 1), GRID_COLUMNS - col)
  return { col, row: position.row, sizeX, sizeY: Math.min(Math.max(position.sizeY, 1), MAX_ROW_SPAN) }
}

function tagsReadable(tags: string[]): boolean {
  return tags.length <= MAX_DASHBOARD_TAGS && tags.every((tag) => tag.length <= MAX_DASHBOARD_TAG_CHARS)
}

function snapshotOf(board: MockDashboard): DashboardSnapshot {
  return {
    name: board.name.slice(0, MAX_TITLE_CHARS),
    tags: tagsReadable(board.tags) ? board.tags : [],
    version: board.version ?? null,
    updatedAt: board.updated_at || null,
    widgets: board.widgets.map((widget) => ({
      widgetId: widget.id,
      kind: widget.visualization ? 'visualization' : 'text',
      title: titleOfWidget(widget),
      position: gridOf(widget.options.position),
      updatedAt: widget.updated_at || null,
    })),
  }
}

function sameTags(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().every((tag, index) => tag === [...b].sort()[index])
}

async function readableQuery(
  transport: RedashTransport,
  queryId: number,
  signal: AbortSignal
): Promise<RedashQuery | null> {
  try {
    return await fetchQuery(transport, queryId, signal)
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return null
    throw error
  }
}

function layoutOf(positions: Map<string, GridPosition>) {
  return [...positions.values()].map((position) => ({ options: { position } }))
}

function overlap(a: GridPosition, b: GridPosition): boolean {
  return a.col < b.col + b.sizeX && b.col < a.col + a.sizeX && a.row < b.row + b.sizeY && b.row < a.row + a.sizeY
}

function overlapProblems(
  explicit: string[],
  positions: Map<string, GridPosition>,
  titles: Map<string, string>
): string[] {
  const problems: string[] = []
  const reported = new Set<string>()
  for (const key of explicit) {
    const own = positions.get(key)
    if (!own) continue
    const other = [...positions.entries()].find(([otherKey, position]) => otherKey !== key && overlap(own, position))
    if (!other) continue
    const pair = [key, other[0]].sort().join('|')
    if (reported.has(pair)) continue
    reported.add(pair)
    const title = titles.get(key) ?? 'A new widget'
    const otherTitle = titles.get(other[0]) ?? 'another new widget'
    problems.push(
      `${title} at col ${own.col}, row ${own.row} overlaps ${otherTitle}; pick another position or leave it out to place it automatically.`
    )
  }
  return problems
}

function place(positions: Map<string, GridPosition>, size: { sizeX: number; sizeY: number }): Position {
  return { ...calculateNewWidgetPosition(layoutOf(positions), size.sizeX, size.sizeY), ...size }
}

async function resolveOperations(
  operations: RequestedOperation[],
  board: MockDashboard,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<Resolution> {
  const widgets = new Map<number, MockDashboardWidget>(board.widgets.map((widget) => [widget.id, widget]))
  const positions = new Map<string, GridPosition>(
    board.widgets.map((widget) => [String(widget.id), gridOf(widget.options.position)])
  )
  const titles = new Map<string, string>(board.widgets.map((widget) => [String(widget.id), titleOfWidget(widget)]))
  const explicit: string[] = []
  for (const [index, operation] of operations.entries()) {
    if (operation.op === 'remove') {
      positions.delete(String(operation.widgetId))
    } else if (operation.op === 'move' && widgets.has(operation.widgetId)) {
      positions.set(String(operation.widgetId), operation.position)
      explicit.push(String(operation.widgetId))
    } else if ((operation.op === 'add' || operation.op === 'addText') && operation.position) {
      positions.set(`new-${index}`, operation.position)
      explicit.push(`new-${index}`)
    }
  }
  const resolved: DashboardOperation[] = []
  const problems: string[] = []

  for (const [index, operation] of operations.entries()) {
    const label = `Operation ${index + 1}`
    const key = `new-${index}`
    if (operation.op === 'addText') {
      const position = operation.position ?? place(positions, TEXT_SIZE)
      positions.set(key, position)
      titles.set(key, `Text: ${textTitle(operation.text)}`)
      resolved.push({ op: 'addText', text: operation.text, position })
      continue
    }
    if (operation.op === 'add') {
      if (operation.queryDraftId !== undefined) {
        const position = operation.position ?? place(positions, getDefaultSize(''))
        positions.set(key, position)
        titles.set(key, DRAFT_WIDGET_TITLE)
        resolved.push({
          op: 'add',
          queryDraftId: operation.queryDraftId,
          title: DRAFT_WIDGET_TITLE,
          position,
          ...(operation.parameterMappings ? { parameterMappings: operation.parameterMappings } : {}),
        })
        continue
      }
      const { queryId, visualizationId } = operation
      if (queryId === undefined || visualizationId === undefined) {
        problems.push(`${label}: an add names a queryId with a visualizationId, or a queryDraftId.`)
        continue
      }
      const query = await readableQuery(transport, queryId, signal)
      if (!query) {
        problems.push(`${label}: query ${queryId} is not available to the analyst.`)
        continue
      }
      const visualization = (query.visualizations ?? []).find((one) => one.id === visualizationId)
      if (!visualization) {
        problems.push(`${label}: query ${queryId} has no visualization ${visualizationId}.`)
        continue
      }
      const mapped = operation.parameterMappings
        ? resolveMappings(label, queryId, query.options?.parameters ?? [], operation.parameterMappings)
        : null
      if (mapped && mapped.problems.length > 0) {
        problems.push(...mapped.problems)
        continue
      }
      const position = operation.position ?? place(positions, getDefaultSize(visualization.type))
      const title = widgetTitle(query.name.slice(0, MAX_TITLE_CHARS), visualization.name).slice(0, MAX_TITLE_CHARS)
      positions.set(key, position)
      titles.set(key, title)
      resolved.push({
        op: 'add',
        queryId,
        visualizationId,
        title,
        position,
        ...(mapped ? { parameterMappings: mapped.mappings } : {}),
      })
      continue
    }
    const widget = widgets.get(operation.widgetId)
    if (!widget) {
      problems.push(`${label}: widget ${operation.widgetId} is not on this dashboard.`)
      continue
    }
    if (operation.op === 'editText' && widget.visualization) {
      problems.push(`${label}: widget ${widget.id} is a chart, not a text box, so its text cannot be edited.`)
      continue
    }
    if (!widget.updated_at) {
      problems.push(`${label}: widget ${widget.id} has no last-edit time to protect, so chat will not change it.`)
      continue
    }
    const target = { widgetId: widget.id, title: titleOfWidget(widget), updatedAt: widget.updated_at }
    const current = placed(gridOf(widget.options.position))
    if (operation.op === 'editText') {
      resolved.push({ op: 'editText', ...target, text: operation.text, position: current })
    } else if (operation.op === 'move') {
      resolved.push({ op: 'move', ...target, position: operation.position })
    } else {
      resolved.push({ op: 'remove', ...target, position: current })
    }
  }
  problems.push(...overlapProblems(explicit, positions, titles))
  return { operations: resolved, problems }
}

export async function resolveDashboardEdit(
  request: Request,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatToolResult> {
  const { dashboardId, name, tags, operations = [] } = request.args
  try {
    const raw = await getRawDashboard(transport, dashboardId, signal)
    if (!raw || raw.is_archived) return failed(NOT_AVAILABLE)
    if (!raw.can_edit) return failed(CANNOT_EDIT_DASHBOARD)
    const board = normalizeDashboard(raw)
    if (board.widgets.length > MAX_SNAPSHOT_WIDGETS) return failed(TOO_MANY_WIDGETS)
    if (tags !== undefined && !tagsReadable(board.tags)) return failed(TOO_MANY_TAGS)
    const snapshot = snapshotOf(board)
    const { operations: resolved, problems } = await resolveOperations(operations, board, transport, signal)
    const changedName = name !== undefined && name !== snapshot.name
    const changedTags = tags !== undefined && !sameTags(tags, snapshot.tags ?? [])
    return {
      kind: 'dashboard_edit',
      ok: true,
      dashboardId,
      snapshot,
      ...(changedName ? { name } : {}),
      ...(changedTags ? { tags } : {}),
      operations: problems.length > 0 ? [] : resolved,
      problems: problems.slice(0, MAX_PROBLEMS).map((problem) => problem.slice(0, MAX_PROBLEM_CHARS)),
    }
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError && error.status === 403) return failed(NOT_AVAILABLE)
    return failed(readQueryError(error).message)
  }
}
