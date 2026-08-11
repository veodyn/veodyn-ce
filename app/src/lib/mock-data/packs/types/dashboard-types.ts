// The dashboard fixture shapes. Originally split out of `la/dashboards.ts` to
// stay under the repo's file-size hook, mirroring query-types.ts, which the
// query fixtures split out for the same reason. Relocated here so the type is
// pack-neutral and `packs/la` can be deleted later without taking it along.
// `la/dashboards.ts` re-exports both names, so the many `from './dashboards'`
// imports inside packs/la keep resolving; packs/neutral imports directly from
// here.
import type { MockQueryParameter } from './query-types'

export interface MockDashboardWidget {
  id: number
  dashboard_id: number
  visualization?: {
    id: number
    type: string
    name: string
    description: string
    options: Record<string, unknown>
    // Mirrors the real Redash widget payload: the visualization carries its
    // query ref inline (with cached-result pointers in real mode).
    query: {
      id: number
      name?: string
      // The query's owner, as serialize_query sends it (with_user defaults to
      // True, and serialize_visualization always serializes its query). It is
      // what lets a widget answer "may this reader edit this visualization?"
      // without a request of its own. Optional because the fixtures below leave
      // it out, and an absent owner reads as "not mine", which is the safe way
      // for that to fail.
      user?: { id: number }
      data_source_id?: number
      // The query's parameter definitions, as serialize_query sends them. A
      // dashboard needs them both to draw a control for its own parameters and
      // to know what each widget's query requires, since the backend refuses a
      // parameterised query run with a value missing rather than defaulting it.
      options?: { parameters?: MockQueryParameter[] }
      latest_query_data_id?: number | null
      latest_query_data?: {
        id: number
        data: { columns: { name: string; type: string; friendly_name: string }[]; rows: Record<string, unknown>[] }
        retrieved_at?: string
      } | null
    }
  }
  text?: string
  width: number
  options: {
    position: { col: number; row: number; sizeX: number; sizeY: number }
    parameterMappings?: Record<string, unknown>
    isHidden?: boolean
  }
}

export interface MockDashboard {
  id: number
  name: string
  slug: string
  tags: string[]
  is_archived: boolean
  is_draft: boolean
  is_favorite: boolean
  can_edit: boolean
  user: { id: number; name: string; email: string }
  widgets: MockDashboardWidget[]
  dashboard_filters_enabled: boolean
  created_at: string
  updated_at: string
  public_url: string | null
  api_key: string | null
  // Real Redash only: optimistic-lock version, echoed on updates (409 on stale)
  version?: number
}
