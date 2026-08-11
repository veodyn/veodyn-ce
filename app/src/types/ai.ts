// AI creation contract types. The request payload shapes to /api/ai/* are fixed
// here; the model and prompt internals are server-side and provider-swappable
// (AI spec section 5, 9). All AI features are gated on ai.enabled.

export interface AiDatasetColumn {
  name: string
  type: string
  description?: string
}

// The grounding: dataset schema + catalog metadata passed to generate-SQL.
export interface AiDataset {
  table: string
  columns: AiDatasetColumn[]
}

export interface GenerateSqlRequest {
  prompt: string
  dataset: AiDataset
  // Optional prior SQL for the "edit with prompt" iteration path.
  currentSql?: string
}

export interface GenerateSqlResponse {
  sql: string
  rationale: string
}

// The Visual builder spec (deterministic; compiled by compileVisualQuery).
export type VisualAggFn = 'sum' | 'avg' | 'count' | 'min' | 'max'

export interface VisualAggregate {
  column: string
  fn: VisualAggFn
  alias: string
}

export interface VisualFilter {
  column: string
  op: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'like'
  value: string
}

export interface VisualSort {
  column: string
  dir: 'asc' | 'desc'
}

export interface VisualQuerySpec {
  dataset: string // dataset table/id (single dataset only)
  dimensions: string[]
  aggregates: VisualAggregate[]
  filters: VisualFilter[]
  sort: VisualSort[]
  limit: number
  chartType: string // a Redash viz type for the generated visualization
}
