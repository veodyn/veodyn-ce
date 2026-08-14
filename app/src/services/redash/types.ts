// Redash REST wire shapes (snake_case, as returned by the Redash API).
// These intentionally mirror the Mock* types in src/lib/mock-data (the mock
// data was modeled on the same wire format), plus the fields that only exist
// on real responses (version, query_hash, api_key, nested visualization.query).

export interface RedashUserRef {
  id: number
  name: string
  email: string
}

export interface RedashParameter {
  name: string
  type: string
  title?: string
  value?: unknown
  enumOptions?: string
  queryId?: number
}

export interface RedashSchedule {
  interval: number
  time?: string | null
  // Stock Redash sends weekday names as strings; luka_admin typed this as
  // number. Accept both and trust the live response.
  day_of_week?: string | number | null
  until?: string | null
  disabled?: boolean
}

export interface RedashVisualization {
  id: number
  type: string // TABLE, CHART, COUNTER, PIVOT, FUNNEL, DETAILS, MAP
  name: string
  description: string
  options: Record<string, unknown>
  // Present on widget payloads (GET dashboards/:id); absent on the inline
  // visualizations array of GET queries/:id.
  query?: {
    id: number
    name: string
    data_source_id: number
    latest_query_data_id: number | null
    latest_query_data?: RedashQueryResult | null
    // Redash's serialize_query sends the owner unless with_user is turned off,
    // and serialize_visualization never turns it off. Declared here because a
    // widget decides whether to offer editing from it: admin-or-owner is the
    // same rule the query editor applies, and this is the only place the answer
    // arrives without a request per widget.
    user?: { id: number; name?: string; email?: string }
    // serialize_query sends the whole options blob, and the parameter
    // definitions inside it are what a dashboard needs both to draw a control
    // and to know what each widget's query requires.
    options?: { parameters?: RedashParameter[] }
  }
  created_at: string
  updated_at: string
  // The embed share token, when this visualization has one. Sent only by
  // GET queries/:id and only to an admin or the query's owner, because it is a
  // credential: whoever holds it can read the result anonymously. Absent means
  // "no link, or none you may see", which the UI treats the same way.
  api_key?: string
}

export interface RedashQuery {
  id: number
  name: string
  description: string | null
  query: string
  query_hash?: string
  data_source_id: number
  is_archived: boolean
  is_draft: boolean
  is_favorite: boolean
  tags: string[]
  schedule: RedashSchedule | null
  options: {
    parameters?: RedashParameter[]
    apply_auto_limit?: boolean
  }
  user: RedashUserRef
  last_modified_by?: RedashUserRef
  created_at: string
  updated_at: string
  retrieved_at: string | null
  runtime: number | null
  version?: number
  latest_query_data_id: number | null
  // This query's own results key, on the same terms as the embed token above:
  // sent by GET queries/:id and by regenerate_api_key, and only to an admin or
  // the owner. It is a permanent credential, so a plain viewer gets a response
  // without the field rather than an empty one. ApiKeyDialog renders its own
  // empty state for that; never substitute another value for it.
  api_key?: string
  visualizations?: RedashVisualization[]
  can_edit?: boolean
}

export interface RedashQueryResultColumn {
  name: string
  type: string
  friendly_name: string
}

export interface RedashQueryResult {
  id: number
  query_hash: string
  query: string
  data: {
    columns: RedashQueryResultColumn[]
    rows: Record<string, unknown>[]
  }
  data_source_id: number
  runtime: number | null
  retrieved_at: string
}

// Redash job statuses (GET /api/jobs/:id)
export const JOB_STATUS = {
  PENDING: 1,
  STARTED: 2,
  SUCCESS: 3,
  FAILURE: 4,
  CANCELLED: 5,
} as const

export interface RedashJob {
  id: string // UUID
  status: number
  error: string
  result_id?: number | null
  query_result_id?: number | null
  updated_at?: number
}

// Execution endpoints return either a cached result or a job to poll.
export interface RedashExecutionResponse {
  query_result?: RedashQueryResult
  job?: RedashJob
}

export interface RedashWidget {
  id: number
  dashboard_id: number
  visualization_id?: number | null
  visualization?: RedashVisualization
  text: string
  width: number
  options: {
    position?: {
      col: number
      row: number
      sizeX: number
      sizeY: number
      autoHeight?: boolean
    }
    isHidden?: boolean
    parameterMappings?: Record<string, unknown>
  }
  created_at: string
  updated_at: string
}

export interface RedashDashboard {
  id: number
  name: string
  slug: string
  user_id?: number
  user?: RedashUserRef
  layout?: unknown[]
  widgets?: RedashWidget[]
  dashboard_filters_enabled: boolean
  options?: Record<string, unknown>
  is_archived: boolean
  is_draft: boolean
  is_favorite: boolean
  tags: string[]
  created_at: string
  updated_at: string
  version?: number
  public_url?: string | null
  api_key?: string
  can_edit?: boolean
}

export interface RedashPaginatedResponse<T> {
  count: number
  page: number
  page_size: number
  results: T[]
}

// GET data_sources/:id/schema: column shape varies by query runner,
// some return plain string[], others return {name, type} objects.
export interface RedashSchemaTableRaw {
  name: string
  columns: Array<string | { name: string; type?: string | null }>
}

export interface RedashSchemaResponse {
  schema?: RedashSchemaTableRaw[]
  job?: RedashJob
}

// Visualization/chart-type option shapes (RedashChartOptions and friends)
// moved to ./visualization-options and re-exported here so existing imports
// from '@/services/redash/types' keep working unchanged.
export * from './visualization-options'
