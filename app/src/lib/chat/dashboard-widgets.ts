import type { MockDashboardWidget } from '@/lib/mock-data'
import { MAPPING_TYPES, type GridPosition, type MappingType, type ParameterMappingValue } from './dashboard-changes'
import type { ChatDashboardWidget, ChatToolResult } from './tool-results'

export const TEXT_TITLE_CHARS = 80
const TITLE_CHARS = 500
const TYPE_CHARS = 64
const TEXT_CHARS = 4_000
const MAPPING_NAME_CHARS = 255
const MAP_TO_CHARS = 100
const MAPPING_TITLE_CHARS = 255
const MAX_MAPPINGS = 50
const NO_TEXT_TITLE = 'Text box'

function optional(value: string | null | undefined, limit: number): string | undefined {
  const clipped = (value ?? '').slice(0, limit).trim()
  return clipped ? clipped : undefined
}

export function widgetTitle(queryName: string | undefined, visualizationName: string): string {
  if (!queryName) return visualizationName
  if (!visualizationName || visualizationName === 'Table') return queryName
  return `${queryName} · ${visualizationName}`
}

export function textTitle(text: string | undefined): string {
  const first = (text ?? '').split('\n').find((line) => line.trim() !== '')
  return first ? first.trim().slice(0, TEXT_TITLE_CHARS) : NO_TEXT_TITLE
}

function whole(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0
}

export function gridOf(position: Partial<GridPosition> | undefined): GridPosition {
  return {
    col: whole(position?.col),
    row: whole(position?.row),
    sizeX: whole(position?.sizeX),
    sizeY: whole(position?.sizeY),
  }
}

function isMappingType(value: unknown): value is MappingType {
  return typeof value === 'string' && (MAPPING_TYPES as readonly string[]).includes(value)
}

export function mappingsOf(raw: unknown): Record<string, ParameterMappingValue> | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const mappings: Record<string, ParameterMappingValue> = {}
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (name === '' || name.length > MAPPING_NAME_CHARS || Object.keys(mappings).length >= MAX_MAPPINGS) continue
    if (entry === null || typeof entry !== 'object') continue
    const one = entry as Record<string, unknown>
    if (!isMappingType(one.type)) continue
    const mapTo = typeof one.mapTo === 'string' ? optional(one.mapTo, MAP_TO_CHARS) : undefined
    const title = typeof one.title === 'string' ? optional(one.title, MAPPING_TITLE_CHARS) : undefined
    mappings[name] = {
      type: one.type,
      ...(mapTo ? { mapTo } : {}),
      ...(one.value !== undefined ? { value: one.value } : {}),
      ...(title ? { title } : {}),
    }
  }
  return Object.keys(mappings).length > 0 ? mappings : undefined
}

export function titleOfWidget(widget: MockDashboardWidget): string {
  const visualization = widget.visualization
  if (!visualization) return textTitle(widget.text)
  return widgetTitle(optional(visualization.query.name, TITLE_CHARS), visualization.name).slice(0, TITLE_CHARS)
}

export function chatWidget(widget: MockDashboardWidget): ChatDashboardWidget {
  const visualization = widget.visualization
  const common = {
    widgetId: widget.id,
    title: titleOfWidget(widget),
    position: gridOf(widget.options.position),
    updatedAt: optional(widget.updated_at, TYPE_CHARS),
  }
  if (!visualization) {
    return { ...common, kind: 'text', text: (widget.text ?? '').slice(0, TEXT_CHARS) }
  }
  return {
    ...common,
    kind: 'visualization',
    queryId: visualization.query.id,
    queryName: optional(visualization.query.name, TITLE_CHARS),
    visualizationId: visualization.id,
    visualizationType: visualization.type.slice(0, TYPE_CHARS),
    parameterMappings: mappingsOf(widget.options.parameterMappings),
  }
}

const LEGACY_ID_BASE = 1_000_000_000
const LEGACY_POSITION = { col: 0, row: 0, sizeX: 3, sizeY: 8 }

export function withLegacyWidgets(content: Record<string, unknown>): Record<string, unknown> {
  if (content.kind !== 'dashboard' || !Array.isArray(content.widgets)) return content
  const widgets = content.widgets.map((widget: unknown, index: number) => {
    if (widget === null || typeof widget !== 'object') return widget
    const one = widget as Record<string, unknown>
    return {
      ...one,
      widgetId: one.widgetId ?? LEGACY_ID_BASE + index,
      kind: one.kind ?? 'visualization',
      position: one.position ?? LEGACY_POSITION,
    }
  })
  return { ...content, widgets }
}

export function withoutLegacyIds(result: ChatToolResult): ChatToolResult {
  if (result.kind !== 'dashboard' || !result.widgets) return result
  const widgets = result.widgets.map((widget) =>
    widget.widgetId >= LEGACY_ID_BASE ? { ...widget, widgetId: LEGACY_ID_BASE - widget.widgetId - 1 } : widget
  )
  return { ...result, widgets }
}
