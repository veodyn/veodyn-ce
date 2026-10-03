export interface QueryResultColumn {
  name: string
  friendly_name: string
  type: string
}

export interface QueryResultData {
  columns: QueryResultColumn[]
  rows: Record<string, unknown>[]
}

export interface MockVisualization {
  id: number
  type: string
  name: string
  description: string
  options: Record<string, unknown>
  created_at: string
  updated_at: string
  api_key?: string
}
