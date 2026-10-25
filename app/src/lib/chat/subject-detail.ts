import { formatQuerySchedule } from '@/lib/format-schedule'
import type { QuerySchedule } from '@/lib/query-schedule'
import { getJson, type Access, type ContextReader } from './redash-get'
import type { ChatThreadSubject } from './wire'

export const SUBJECT_SQL_CHARS = 4000
export const SUBJECT_MAX_LINES = 40
export const SUBJECT_LINE_CHARS = 500
const SUBJECT_NAME_CHARS = 500
const SUBJECT_ID_CHARS = 64
const TEXT_TITLE_CHARS = 100

export interface ChatSubjectDetail {
  kind: ChatThreadSubject['kind']
  id: string
  name: string
  canEdit?: boolean
  lines: string[]
}

interface RawVisualization {
  id: number
  type?: string
  name?: string
  options?: Record<string, unknown> | null
  query?: { id: number; name?: string }
}

interface RawQuery {
  id: number
  name: string
  can_edit?: boolean
  data_source_id?: number
  query?: string
  schedule?: QuerySchedule | null
  options?: { parameters?: { name?: string; type?: string }[] }
  visualizations?: RawVisualization[]
}

interface RawPosition {
  col: number
  row: number
  sizeX: number
  sizeY: number
}

interface RawWidget {
  id: number
  text?: string
  visualization?: RawVisualization | null
  options?: { position?: RawPosition }
}

interface RawDashboard {
  id: number
  name: string
  can_edit?: boolean
  widgets?: RawWidget[]
}

const clipLine = (text: string): string => text.slice(0, SUBJECT_LINE_CHARS)

function detail(
  kind: ChatSubjectDetail['kind'],
  id: string | number,
  name: string,
  lines: string[],
  canEdit?: boolean
): ChatSubjectDetail {
  return {
    kind,
    id: String(id).slice(0, SUBJECT_ID_CHARS),
    name: name.slice(0, SUBJECT_NAME_CHARS),
    ...(canEdit === undefined ? {} : { canEdit }),
    lines: lines.slice(0, SUBJECT_MAX_LINES).map(clipLine),
  }
}

function sqlLines(sql: string): string[] {
  const clipped = sql.slice(0, SUBJECT_SQL_CHARS)
  return clipped
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => line.match(new RegExp(`.{1,${SUBJECT_LINE_CHARS}}`, 'g')) ?? [])
}

function queryLines(query: RawQuery): string[] {
  const parameters = (query.options?.parameters ?? []).map((p) => `${p.name} (${p.type})`)
  const visualizations = (query.visualizations ?? []).map((v) => `${v.id} ${v.type} "${v.name}"`)
  return [
    ...(query.data_source_id === undefined ? [] : [`data source: ${query.data_source_id}`]),
    ...(parameters.length ? [`parameters: ${parameters.join(', ')}`] : []),
    ...(visualizations.length ? [`visualizations: ${visualizations.join('; ')}`] : []),
    `schedule: ${formatQuerySchedule(query.schedule).text}`,
    'SQL:',
    ...sqlLines(query.query ?? ''),
  ]
}

function widgetTitle(widget: RawWidget): string {
  const viz = widget.visualization
  if (viz) return viz.query?.name ? `${viz.query.name}: ${viz.name}` : String(viz.name)
  return (widget.text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_TITLE_CHARS)
}

const positionOf = (widget: RawWidget): string | null => {
  const p = widget.options?.position
  return p ? `col ${p.col}, row ${p.row}, size ${p.sizeX}x${p.sizeY}` : null
}

function widgetLine(widget: RawWidget): string {
  const position = positionOf(widget)
  const kind = widget.visualization ? 'visualization' : 'text'
  return `widget ${widget.id} (${kind}) "${widgetTitle(widget)}"${position ? ` at ${position}` : ''}`
}

function dashboardLines(widgets: RawWidget[]): string[] {
  if (widgets.length <= SUBJECT_MAX_LINES) return widgets.map(widgetLine)
  const shown = widgets.slice(0, SUBJECT_MAX_LINES - 1).map(widgetLine)
  return [...shown, `and ${widgets.length - shown.length} more widgets`]
}

function widgetLines(dashboard: RawDashboard, widget: RawWidget): string[] {
  const viz = widget.visualization
  const position = positionOf(widget)
  return [
    `dashboard: ${dashboard.id} "${dashboard.name}"`,
    `kind: ${viz ? 'visualization' : 'text'}`,
    `title: ${widgetTitle(widget)}`,
    ...(viz?.query ? [`query: ${viz.query.id}`] : []),
    ...(viz ? [`visualization: ${viz.id}`] : []),
    ...(position ? [`position: ${position}`] : []),
  ]
}

async function readOne(subject: ChatThreadSubject, access: Access): Promise<ChatSubjectDetail | null> {
  switch (subject.kind) {
    case 'query': {
      const query = await getJson<RawQuery>(`/api/queries/${subject.queryId}`, access)
      return query ? detail('query', query.id, query.name, queryLines(query), query.can_edit === true) : null
    }
    case 'visualization': {
      const query = await getJson<RawQuery>(`/api/queries/${subject.queryId}`, access)
      const viz = query?.visualizations?.find((v) => v.id === subject.visualizationId)
      if (!query || !viz) return null
      const keys = Object.keys(viz.options ?? {})
      const lines = [
        `type: ${viz.type}`,
        `query: ${query.id} "${query.name}"`,
        ...(keys.length ? [`options set: ${keys.join(', ')}`] : []),
      ]
      return detail('visualization', viz.id, `${query.name}: ${viz.name}`, lines, query.can_edit === true)
    }
    case 'dashboard': {
      const dashboard = await getJson<RawDashboard>(`/api/dashboards/${subject.dashboardId}`, access)
      if (!dashboard) return null
      const lines = dashboardLines(dashboard.widgets ?? [])
      return detail('dashboard', dashboard.id, dashboard.name, lines, dashboard.can_edit === true)
    }
    case 'widget': {
      const dashboard = await getJson<RawDashboard>(`/api/dashboards/${subject.dashboardId}`, access)
      const widget = dashboard?.widgets?.find((w) => w.id === subject.widgetId)
      if (!dashboard || !widget) return null
      return detail('widget', widget.id, dashboard.name, widgetLines(dashboard, widget), dashboard.can_edit === true)
    }
    case 'dataset':
      return detail('dataset', String(subject.datasetId), String(subject.datasetId), [])
    case 'new':
      return detail('new', String(subject.newKind), String(subject.newKind), [])
  }
}

export async function readSubjectDetail(
  subject: ChatThreadSubject,
  reader: ContextReader,
  signal: AbortSignal
): Promise<ChatSubjectDetail | null> {
  try {
    return await readOne(subject, { ...reader, signal })
  } catch {
    return null
  }
}
