// The shapes Redash actually sends back, as far as these tools read them.
// Deliberately partial: a field this app does not use is a field it cannot be
// broken by.

export interface Paginated<T> {
  count?: number
  results?: T[]
}

export interface RedashQuery {
  id: number
  name: string
  description: string | null
  schedule: { interval: number | null } | null
  query?: string
  options?: { parameters?: unknown[] }
  data_source_id?: number
  updated_at?: string
}

export interface RedashDashboard {
  id: number
  name: string
  slug: string
  updated_at?: string
  widgets?: {
    id: number
    text?: string
    visualization?: { id: number; name: string; type: string; query?: RedashQuery }
  }[]
}

export interface RedashResultBody {
  id: number
  data: { columns: { name: string; type: string }[]; rows: Record<string, unknown>[] }
  retrieved_at: string
  runtime: number
}

export interface RedashJob {
  id: string
  status: number
  error?: string
  query_result_id?: number | null
}

/** POST /results answers with a finished result, or a job to poll. */
export interface RedashExecution {
  query_result?: RedashResultBody
  job?: RedashJob
}
