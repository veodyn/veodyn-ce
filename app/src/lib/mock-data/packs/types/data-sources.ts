// Pack-neutral home for the data-source fixture shape. `la/data-sources.ts`
// re-exports this so `from './data-sources'` imports inside packs/la keep
// resolving; packs/neutral imports directly from here.
export interface MockDataSource {
  id: number
  name: string
  type: string
  syntax: string
  paused: number
  pause_reason: string | null
  options: Record<string, unknown>
  groups: Record<string, boolean>
  created_at: string
  view_only: boolean
}
