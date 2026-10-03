import type { QueryResultColumn, QueryResultData } from '@veodyn/viz/types/viz-data'

export type { QueryResultColumn, QueryResultData }
// Pack-neutral home for the query-result fixture shapes.
// `la/query-results.ts` re-exports these so `from './query-results'` imports
// inside packs/la keep resolving; packs/neutral imports directly from here.


export interface MockQueryResult {
  id: number
  query_hash: string
  query: string
  data: QueryResultData
  data_source_id: number
  runtime: number
  retrieved_at: string
}
