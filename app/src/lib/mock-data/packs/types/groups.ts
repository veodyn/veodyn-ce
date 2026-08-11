// Pack-neutral home for the group fixture shapes. `la/groups.ts` re-exports
// these so `from './groups'` imports inside packs/la keep resolving;
// packs/neutral imports directly from here.
export interface MockGroupMember {
  id: number
  name: string
  email: string
}

export interface MockGroupDataSource {
  id: number
  name: string
  type: string
  view_only: boolean
}

export interface MockGroup {
  id: number
  name: string
  type: string
  created_at: string
  permissions: string[]
  members: MockGroupMember[]
  data_sources: MockGroupDataSource[]
}
