// ---------------------------------------------------------------------------
// Shared Redash user/group types. Extracted out of admin-user-detail.tsx so
// that shared components (ApiKeyPanel, ChangePasswordDialog, and the profile
// page) can depend on the types without depending on the admin container.
// ---------------------------------------------------------------------------

export interface RedashUserDetail {
  id: number
  name: string
  email: string
  profile_image_url: string | null
  groups: number[]
  created_at: string
  updated_at: string
  disabled_at: string | null
  is_disabled: boolean
  active_at: string | null
  is_invitation_pending: boolean
  is_email_verified: boolean
  auth_type: string
  api_key: string
}

export interface RedashGroup {
  id: number
  name: string
  type: string
}
