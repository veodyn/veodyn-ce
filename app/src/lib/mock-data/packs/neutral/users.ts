import type { MockUser } from '../types/users'

// profile_image_url carries a synthesised gravatar URL rather than an empty
// string, because that is what Redash actually returns: User.profile_image_url
// falls back to gravatar.com/avatar/<md5(email)> for anyone with no upload
// (node/redash/models/users.py). Mock mode used to return '', so nothing here
// ever exercised the "this is a gravatar, draw initials instead" path.

export const mockUsers: MockUser[] = [
  {
    id: 1,
    name: 'Admin User',
    email: 'admin@example.com',
    profile_image_url:
      'https://www.gravatar.com/avatar/e64c7d89f26bd1972efa854d13d7dd61?s=40&d=identicon',
    groups: [1, 2],
    api_key: 'mock-api-key-admin-001',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2026-03-15T14:30:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-03-18T09:00:00Z',
    is_email_verified: true,
    auth_type: 'password',
  },
  {
    id: 2,
    name: 'Jane Analyst',
    email: 'jane@example.com',
    profile_image_url:
      'https://www.gravatar.com/avatar/9e26471d35a78862c17e467d87cddedf?s=40&d=identicon',
    groups: [2],
    api_key: 'mock-api-key-jane-002',
    created_at: '2024-06-20T08:00:00Z',
    updated_at: '2026-03-10T11:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-03-17T16:45:00Z',
    is_email_verified: true,
    auth_type: 'password',
  },
  {
    id: 3,
    name: 'Bob Developer',
    email: 'bob@example.com',
    profile_image_url:
      'https://www.gravatar.com/avatar/4b9bb80620f03eb3719e0a061c14283d?s=40&d=identicon',
    groups: [2],
    api_key: 'mock-api-key-bob-003',
    created_at: '2025-01-10T14:00:00Z',
    updated_at: '2026-03-12T09:15:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-03-16T10:20:00Z',
    is_email_verified: true,
    auth_type: 'password',
  },
  {
    id: 4,
    name: 'Sarah Viewer',
    email: 'sarah@example.com',
    profile_image_url:
      'https://www.gravatar.com/avatar/62a9731a313984d2576cd2b5528c0725?s=40&d=identicon',
    groups: [3],
    api_key: 'mock-api-key-sarah-004',
    created_at: '2025-08-05T16:00:00Z',
    updated_at: '2025-12-20T12:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-03-15T08:30:00Z',
    is_email_verified: true,
    auth_type: 'password',
  },
  {
    id: 5,
    name: 'Pending User',
    email: 'pending@example.com',
    profile_image_url:
      'https://www.gravatar.com/avatar/e21b9f6164d3cabb4e194aa884fd5768?s=40&d=identicon',
    groups: [2],
    api_key: '',
    created_at: '2026-03-10T10:00:00Z',
    updated_at: '2026-03-10T10:00:00Z',
    is_disabled: false,
    is_invitation_pending: true,
    active_at: '',
    is_email_verified: false,
    auth_type: 'password',
  },
  // The second identity that can publish. Four-eyes needs two of them, and
  // with only one the report subsystem could be submitted for review and then
  // never approved by anybody, which is what a walkthrough of a demo instance
  // ran into.
  {
    id: 6,
    name: 'Maya Reviewer',
    email: 'maya@example.com',
    profile_image_url:
      'https://www.gravatar.com/avatar/7f042523605eb9acbaa4df4ae2d4f20b?s=40&d=identicon',
    groups: [1, 2],
    api_key: 'mock-api-key-maya-006',
    created_at: '2025-02-11T09:00:00Z',
    updated_at: '2026-03-14T13:00:00Z',
    is_disabled: false,
    is_invitation_pending: false,
    active_at: '2026-03-18T08:10:00Z',
    is_email_verified: true,
    auth_type: 'password',
  },
]

export const currentUser = mockUsers[0]
