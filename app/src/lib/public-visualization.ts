// The contract for an anonymously shared visualization, and the one function
// that turns whatever Redash answered into it.
//
// The upstream shape is `public_visualization` in
// node/redash/serializers/__init__.py: `type`, `name`, `description`, `options`,
// `updated_at`, `created_at`, `query`, `query_result`, and no `id`. The query's
// SQL, its data source, its owner and the token never cross this boundary, so an
// embed leaks no more than a shared dashboard. The omission is pinned by
// node/tests/handlers/test_visualization_share.py.

import type { QueryResultData } from '@/lib/mock-data'

export interface PublicVisualizationConfig {
  type: string
  name: string
  description: string
  options: Record<string, unknown>
}

export interface PublicVisualizationPayload {
  visualization: PublicVisualizationConfig
  /**
   * Null when the owning query has never produced a result. Kept rather than
   * treated as a miss, because whether that is fatal depends on the TYPE: a
   * chart with nothing to draw is a dead link, while a `needs: 'none'` plugin
   * (a wall image panel, a backdrop) never waits for a result at all. The
   * registry lives in the client bundle, so the page, not this module, asks
   * `visualizationData` which case it is holding.
   */
  data: QueryResultData | null
}

// `MockVisualization` wants a numeric id and upstream sends none. A local
// stand-in, so no internal id is named to an anonymous reader.
export const PUBLIC_VISUALIZATION_ID = 0

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// Runs twice on the way to a reader: in the route handler on Redash's body, and
// in the client service on the route handler's output. Those two shapes only;
// anything else returns null and the caller answers 404.
function pickVisualization(root: Record<string, unknown>): Record<string, unknown> {
  return asRecord(root.visualization) ?? root
}

function pickResultData(root: Record<string, unknown>): Record<string, unknown> | null {
  // Upstream nests the table under `query_result.data`; this function's own
  // output carries it as `data`.
  const queryResult = asRecord(root.query_result)
  if (queryResult) return asRecord(queryResult.data)
  return asRecord(root.data)
}

export function normalizePublicVisualization(raw: unknown): PublicVisualizationPayload | null {
  const root = asRecord(raw)
  if (!root) return null

  const viz = pickVisualization(root)
  // The serializer always sends `type`, so a body without one is not a
  // visualization payload at all.
  if (typeof viz.type !== 'string') return null

  // `query_result` is null whenever the owning query has never run. A result
  // that is PRESENT but malformed still fails the whole payload: that is a
  // contract violation, not an empty state.
  const result = pickResultData(root)
  let data: QueryResultData | null = null
  if (result) {
    const columns = result.columns
    const rows = result.rows
    if (!Array.isArray(columns) || !Array.isArray(rows)) return null
    data = {
      columns: columns as QueryResultData['columns'],
      rows: rows as QueryResultData['rows'],
    }
  }

  return {
    visualization: {
      type: viz.type,
      name: typeof viz.name === 'string' ? viz.name : '',
      description: typeof viz.description === 'string' ? viz.description : '',
      options: asRecord(viz.options) ?? {},
    },
    data,
  }
}
