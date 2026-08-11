import type { MockGroup } from '../types/groups'

export const mockGroups: MockGroup[] = [
  {
    id: 1,
    name: 'admin',
    type: 'builtin',
    created_at: '2024-01-15T10:00:00Z',
    permissions: [
      'admin',
      'super_admin',
      'list_users',
      'create_query',
      'edit_query',
      'view_query',
      'list_dashboards',
      'create_dashboard',
      'list_alerts',
      'list_data_sources',
    ],
    members: [{ id: 1, name: 'Admin User', email: 'admin@example.com' }],
    data_sources: [
      { id: 1, name: 'Production PostgreSQL', type: 'pg', view_only: false },
      { id: 2, name: 'Analytics MySQL', type: 'mysql', view_only: false },
      { id: 3, name: 'Realtime API', type: 'json', view_only: false },
    ],
  },
  {
    id: 2,
    name: 'default',
    type: 'builtin',
    created_at: '2024-01-15T10:00:00Z',
    permissions: [
      'create_query',
      'edit_query',
      'view_query',
      'list_dashboards',
      'create_dashboard',
      'list_alerts',
      'list_data_sources',
    ],
    members: [
      { id: 1, name: 'Admin User', email: 'admin@example.com' },
      { id: 2, name: 'Jane Analyst', email: 'jane@example.com' },
      { id: 3, name: 'Bob Developer', email: 'bob@example.com' },
      { id: 5, name: 'Pending User', email: 'pending@example.com' },
    ],
    data_sources: [
      { id: 1, name: 'Production PostgreSQL', type: 'pg', view_only: false },
      { id: 2, name: 'Analytics MySQL', type: 'mysql', view_only: false },
      { id: 3, name: 'Realtime API', type: 'json', view_only: true },
    ],
  },
  {
    id: 3,
    name: 'readonly',
    type: 'regular',
    created_at: '2025-03-01T10:00:00Z',
    permissions: ['view_query', 'list_dashboards', 'list_alerts'],
    members: [{ id: 4, name: 'Sarah Viewer', email: 'sarah@example.com' }],
    data_sources: [
      { id: 1, name: 'Production PostgreSQL', type: 'pg', view_only: true },
      { id: 2, name: 'Analytics MySQL', type: 'mysql', view_only: true },
    ],
  },
]
