// Pack-neutral home for the destination fixture shape. `la/destinations.ts`
// re-exports this so `from './destinations'` imports inside packs/la keep
// resolving; packs/neutral imports directly from here.
export interface MockDestination {
  id: number
  name: string
  type: string
  options: Record<string, unknown>
  created_at: string
}
