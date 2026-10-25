import type { PublicVisualizationConfig } from './public-visualization'

export const DASHBOARD_COLUMNS = 6

export interface PublicDashboardPosition {
  col: number
  row: number
  sizeX: number
  sizeY: number
}

export interface PublicDashboardParameter {
  name: string
  title: string
  defaultValue: string | null
}

export interface PublicDashboardWidget {
  id: number
  position: PublicDashboardPosition
  hideTitle: boolean
  text: string | null
  visualization: PublicVisualizationConfig | null
  parameters: PublicDashboardParameter[]
}

export interface PublicDashboardPayload {
  name: string
  widgets: PublicDashboardWidget[]
}

export interface PublicParameterValue {
  name: string
  value: string
}

export interface PublicParameterValues {
  values: PublicParameterValue[]
  truncated: boolean
}

const PICKER_TYPES = new Set(['enum', 'query'])
const DEFAULT_POSITION: PublicDashboardPosition = { col: 0, row: 0, sizeX: 3, sizeY: 8 }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function wholeNumber(value: unknown, fallback: number, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), low), high)
}

function pickPosition(widget: Record<string, unknown>): PublicDashboardPosition {
  const raw = asRecord(widget.position) ?? asRecord(asRecord(widget.options)?.position) ?? {}
  const col = wholeNumber(raw.col, DEFAULT_POSITION.col, 0, DASHBOARD_COLUMNS - 1)
  return {
    col,
    row: wholeNumber(raw.row, DEFAULT_POSITION.row, 0, 10_000),
    sizeX: wholeNumber(raw.sizeX, DEFAULT_POSITION.sizeX, 1, DASHBOARD_COLUMNS - col),
    sizeY: wholeNumber(raw.sizeY, DEFAULT_POSITION.sizeY, 1, 1_000),
  }
}

function pickVisualization(widget: Record<string, unknown>): PublicVisualizationConfig | null {
  const viz = asRecord(widget.visualization)
  if (!viz || typeof viz.type !== 'string') return null
  return {
    type: viz.type,
    name: typeof viz.name === 'string' ? viz.name : '',
    description: typeof viz.description === 'string' ? viz.description : '',
    options: asRecord(viz.options) ?? {},
  }
}

function records(list: unknown): Record<string, unknown>[] {
  return Array.isArray(list) ? list.map(asRecord).filter((entry) => entry !== null) : []
}

function namedText(entry: Record<string, unknown>, key: string, fallback: string): string {
  const value = entry[key]
  return typeof value === 'string' && value !== '' ? value : fallback
}

function pickParameters(
  widget: Record<string, unknown>,
  visualization: PublicVisualizationConfig | null
): PublicDashboardParameter[] {
  if (Array.isArray(widget.parameters)) {
    return records(widget.parameters).flatMap((entry) =>
      typeof entry.name === 'string'
        ? [
            {
              name: entry.name,
              title: namedText(entry, 'title', entry.name),
              defaultValue: typeof entry.defaultValue === 'string' ? entry.defaultValue : null,
            },
          ]
        : []
    )
  }
  const listed = asRecord(visualization?.options.publicParameters)
  if (!listed) return []
  return records(asRecord(asRecord(asRecord(widget.visualization)?.query)?.options)?.parameters).flatMap((entry) =>
    typeof entry.name === 'string' &&
    entry.name in listed &&
    PICKER_TYPES.has(String(entry.type)) &&
    !asRecord(entry.multiValuesOptions)
      ? [
          {
            name: entry.name,
            title: namedText(entry, 'title', entry.name),
            defaultValue: entry.value == null ? null : String(entry.value),
          },
        ]
      : []
  )
}

function pickWidget(raw: unknown): PublicDashboardWidget | null {
  const widget = asRecord(raw)
  if (!widget || typeof widget.id !== 'number') return null
  const visualization = pickVisualization(widget)
  const hideTitle = widget.hideTitle === true || asRecord(widget.options)?.hideTitle === true
  return {
    id: widget.id,
    position: pickPosition(widget),
    hideTitle,
    text: visualization ? null : typeof widget.text === 'string' ? widget.text : '',
    visualization,
    parameters: pickParameters(widget, visualization),
  }
}

function gridOrder(a: PublicDashboardWidget, b: PublicDashboardWidget): number {
  return a.position.row - b.position.row || a.position.col - b.position.col || a.id - b.id
}

export function normalizePublicDashboard(raw: unknown): PublicDashboardPayload | null {
  const root = asRecord(raw)
  if (!root || !Array.isArray(root.widgets)) return null
  return {
    name: typeof root.name === 'string' ? root.name : '',
    widgets: root.widgets.flatMap((raw) => {
      const widget = pickWidget(raw)
      return widget ? [widget] : []
    }).sort(gridOrder),
  }
}

export function normalizePublicParameterValues(raw: unknown): PublicParameterValues | null {
  const root = asRecord(raw)
  if (!root || !Array.isArray(root.values)) return null
  return {
    values: records(root.values).flatMap((entry) =>
      entry.value == null ? [] : [{ name: String(entry.name ?? entry.value), value: String(entry.value) }]
    ),
    truncated: root.truncated === true,
  }
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export function publicDashboardUrl(baseUrl: string, token: string): string {
  return `${trimBase(baseUrl)}/api/public/dashboards/${encodeURIComponent(token)}`
}

export function publicDashboardWidgetUrl(baseUrl: string, token: string, widgetId: number): string {
  return `${publicDashboardUrl(baseUrl, token)}/widgets/${encodeURIComponent(String(widgetId))}`
}

export function publicParameterValuesUrl(
  baseUrl: string,
  token: string,
  widgetId: number,
  name: string,
  prefix = ''
): string {
  const search = prefix === '' ? '' : `?q=${encodeURIComponent(prefix)}`
  return `${publicDashboardWidgetUrl(baseUrl, token, widgetId)}/parameters/${encodeURIComponent(name)}/values${search}`
}
