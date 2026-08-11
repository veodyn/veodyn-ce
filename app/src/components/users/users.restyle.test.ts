import { describe, expect, it } from 'vitest'
import { findRedashEraChrome, readAppSource } from '@/test/redash-era-chrome'

const files = [
  'app/users/page.tsx',
  'components/users/admin-user-list.tsx',
  'components/users/admin-user-detail.tsx',
  'components/users/group-list.tsx',
  'components/users/group-detail.tsx',
  'components/users/invite-dialog.tsx',
  'components/users/admin-user-detail-security.tsx',
  'components/users/admin-user-detail-groups.tsx',
  'components/users/group-members.tsx',
  'components/users/group-data-sources.tsx',
  'components/users/user-row-actions.tsx',
]

describe('users domain carries no Redash-era chrome', () => {
  it.each(files)('%s uses only Editorial Light tokens/primitives', (rel) => {
    expect(findRedashEraChrome(readAppSource(rel))).toEqual([])
  })
})
