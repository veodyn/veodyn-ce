// @vitest-environment node
import { vi } from 'vitest'
import { testsForInternalKeyRoute } from '../admin-route-test-harness'

testsForInternalKeyRoute({
  label: 'admin status route',
  redashPath: '/status.json',
  routeUrl: 'http://localhost/api/admin/status',
  upstreamBody: { workers: 2, queries_count: 41 },
  loadRoute: async () => {
    // Fresh modules per case so src/lib/env.ts re-reads the env this sets.
    vi.resetModules()
    return import('./route')
  },
})
