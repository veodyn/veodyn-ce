// The contract for an anonymously shared visualization, and the one function
// that turns whatever Redash answered into it.
//
// The upstream shape is not guessed. It is `public_visualization` in
// node/redash/serializers/__init__.py, which returns exactly `type`, `name`,
// `description`, `options`, `updated_at`, `created_at`, `query` and
// `query_result`, and deliberately no `id`: the field set matches
// `public_widget`, so an embed leaks no more than a shared dashboard already
// does. Redash's own test pins that omission
// (node/tests/handlers/test_visualization_share.py). If that serializer
// changes, this file changes with it.
//
// Only what a reader needs to draw a chart crosses this boundary. The query's
// SQL, its data source, its owner and the token itself are all absent, because
// an anonymous embed is a picture of one result, not a door into the query that
// produced it.

import type { QueryResultData } from '@/lib/mock-data'

export interface PublicVisualizationConfig {
  type: string
  name: string
  description: string
  options: Record<string, unknown>
}

export interface PublicVisualizationPayload {
  visualization: PublicVisualizationConfig
  data: QueryResultData
}

// The renderer types a visualization as `MockVisualization`, which wants a
// numeric id, and upstream sends none. A public embed draws one chart and keys
// no list, so a fixed local stand-in does everything the id was doing here.
// Passing a real visualization id to an anonymous reader would buy nothing and
// name an internal object.
export const PUBLIC_VISUALIZATION_ID = 0

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

// This function runs twice on the way to a reader: once in the route handler,
// on Redash's body, and once in the client service, on the route handler's own
// output. So it accepts those two shapes and nothing else. Anything else
// returns null and the caller answers 404, which is the same refusal every
// other failure gets.
function pickVisualization(root: Record<string, unknown>): Record<string, unknown> {
  return asRecord(root.visualization) ?? root
}

function pickResultData(root: Record<string, unknown>): Record<string, unknown> | null {
  // Upstream nests the table one level down, under `query_result.data`:
  // `serialize_query_result` projects an api-user read to `data` and
  // `retrieved_at`. This function's own output carries it as `data`.
  const queryResult = asRecord(root.query_result)
  if (queryResult) return asRecord(queryResult.data)
  return asRecord(root.data)
}

export function normalizePublicVisualization(raw: unknown): PublicVisualizationPayload | null {
  const root = asRecord(raw)
  if (!root) return null

  const viz = pickVisualization(root)
  // `query_result` is null whenever the owning query has never run, so a link
  // to a chart with nothing to draw is a miss rather than an empty picture.
  const result = pickResultData(root)
  if (!result) return null

  const columns = result.columns
  const rows = result.rows
  if (!Array.isArray(columns) || !Array.isArray(rows)) return null
  // `type` is the field the renderer switches on, and the serializer always
  // sends it, so a body without one is not a visualization payload at all.
  if (typeof viz.type !== 'string') return null

  return {
    visualization: {
      type: viz.type,
      name: typeof viz.name === 'string' ? viz.name : '',
      description: typeof viz.description === 'string' ? viz.description : '',
      options: asRecord(viz.options) ?? {},
    },
    data: {
      columns: columns as QueryResultData['columns'],
      rows: rows as QueryResultData['rows'],
    },
  }
}
