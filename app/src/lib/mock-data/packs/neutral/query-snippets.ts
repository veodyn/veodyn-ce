import type { MockQuerySnippet } from '../types/query-snippets'

export const mockQuerySnippets: MockQuerySnippet[] = [
  {
    id: 1,
    trigger: 'last7d',
    description: 'Filter for last 7 days',
    snippet: "WHERE created_at >= NOW() - INTERVAL '7 days'",
    user: { id: 1, name: 'Admin User' },
    created_at: '2024-06-01T10:00:00Z',
    updated_at: '2024-06-01T10:00:00Z',
  },
  {
    id: 2,
    trigger: 'paginate',
    description: 'Pagination with LIMIT and OFFSET',
    snippet: 'LIMIT ${1:100} OFFSET ${2:0}',
    user: { id: 2, name: 'Jane Analyst' },
    created_at: '2025-01-15T14:00:00Z',
    updated_at: '2025-01-15T14:00:00Z',
  },
  {
    id: 3,
    trigger: 'datefmt',
    description: 'Format date column',
    snippet: "TO_CHAR(${1:created_at}, 'YYYY-MM-DD') AS ${2:formatted_date}",
    user: { id: 1, name: 'Admin User' },
    created_at: '2025-03-20T11:00:00Z',
    updated_at: '2025-03-20T11:00:00Z',
  },
]
