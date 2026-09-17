export interface RedashGroupDetail {
  id: number
  name: string
  type: 'builtin' | 'regular'
  permissions: string[]
}

export interface RedashGroupMember {
  id: number
  name: string
  email: string
  profile_image_url: string | null
}

export interface RedashGroupDataSource {
  id: number
  name: string
  type: string
  view_only: boolean
}

export type LoadError = 'not_found' | 'failed'
