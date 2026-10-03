export interface Annotation {
  id: number
  dashboard_id: number
  widget_id: number | null // null = all time-series widgets on the dashboard; set = pinned to one
  start: string // ISO 8601 timestamp
  end: string | null // null = point annotation; set = range [start, end]
  label: string
  source: string // e.g. 'manual' or 'ai-suggested' for an accepted AI draft
  created_at: string
}
