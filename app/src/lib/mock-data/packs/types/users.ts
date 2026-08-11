// Pack-neutral home for the user fixture shape. `la/users.ts` re-exports this
// so `from './users'` imports inside packs/la keep resolving; packs/neutral
// imports directly from here.
export interface MockUser {
  id: number
  name: string
  email: string
  profile_image_url: string
  groups: number[]
  api_key: string
  created_at: string
  updated_at: string
  is_disabled: boolean
  is_invitation_pending: boolean
  active_at: string
  is_email_verified: boolean
  auth_type: string
}
