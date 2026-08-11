// Pack-neutral home for the query-snippet fixture shape.
// `la/query-snippets.ts` re-exports this so `from './query-snippets'` imports
// inside packs/la keep resolving; packs/neutral imports directly from here.
export interface MockQuerySnippet {
  id: number
  trigger: string
  description: string
  snippet: string
  user: { id: number; name: string }
  created_at: string
  updated_at: string
}
