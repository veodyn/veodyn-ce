/**
 * Shapes for the saved-query fixtures. Originally split out of
 * `la/queries.ts` only because that file is a long fixture array; relocated
 * here so the shapes are pack-neutral and `packs/la` can be deleted later
 * without taking the type surface with it. `la/queries.ts` re-exports these,
 * so every existing `from './queries'` import inside packs/la still
 * resolves; packs/neutral imports directly from here.
 */

export interface MockVisualization {
  id: number
  type: string
  name: string
  description: string
  options: Record<string, unknown>
  created_at: string
  updated_at: string
  // Real Redash only: the embed share token, present only for an admin or the
  // owner of the parent query. The fixtures mint no tokens, so anything reading
  // it has to handle its absence rather than substitute another value.
  api_key?: string
}

/**
 * Everything a parameter value can be:
 *
 * - a scalar for text, number, enum and query dropdowns;
 * - `{ start, end }` for a range type, which is the shape the backend reads;
 * - a list for a parameter whose definition allows multiple values, which the
 *   backend joins using that definition's multiValuesOptions;
 * - the sentinel string `d_<key>` for a dynamic date, resolved to concrete
 *   dates at execution time;
 * - null when unset.
 */
export type ParameterValue = string | number | { start: string; end: string } | string[] | null

export interface MockQueryParameter {
  name: string
  title: string
  type: string
  value: ParameterValue
  enumOptions?: string
  queryId?: number
  global?: boolean
  /**
   * Present only on an `enum` or `query` parameter that allows several values,
   * which is exactly how Redash marks one. The quoting it carries is applied by
   * the backend from the query's own schema, so nothing here joins the list.
   */
  multiValuesOptions?: { prefix: string; suffix: string; separator: string }
}

export interface MockQuery {
  id: number
  name: string
  description: string
  query: string
  data_source_id: number
  schedule: {
    interval: number | null
    time: string | null
    day_of_week: string | null
    until: string | null
  } | null
  tags: string[]
  is_archived: boolean
  is_draft: boolean
  is_favorite: boolean
  is_safe: boolean
  can_edit: boolean
  user: { id: number; name: string; email: string }
  last_modified_by: { id: number; name: string; email: string }
  visualizations: MockVisualization[]
  latest_query_data_id: number | null
  options: { parameters: MockQueryParameter[] }
  created_at: string
  updated_at: string
  retrieved_at: string
  runtime: number
  // Real Redash only: optimistic-lock version, echoed on updates (409 on stale)
  version?: number
  // Real Redash only: the query's own API key, for reading its results over the
  // API. Optional because the fixtures do not mint keys, so anything reading it
  // has to handle its absence rather than substitute another value.
  api_key?: string
}
