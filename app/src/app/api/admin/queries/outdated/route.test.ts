// @vitest-environment node
import { vi } from 'vitest'
import { testsForInternalKeyRoute } from '../../admin-route-test-harness'

testsForInternalKeyRoute({
  label: 'outdated queries admin route',
  redashPath: '/api/admin/queries/outdated',
  routeUrl: 'http://localhost/api/admin/queries/outdated',
  upstreamBody: { queries: [{ id: 9 }], updated_at: '2026-07-28T10:00:00Z' },
  loadRoute: async () => {
    // Fresh modules per case so src/lib/env.ts re-reads the env this sets.
    vi.resetModules()
    return import('./route')
  },
})
