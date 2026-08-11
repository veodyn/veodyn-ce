// @vitest-environment node
import { vi } from 'vitest'
import { testsForInternalKeyRoute } from '../../admin-route-test-harness'

testsForInternalKeyRoute({
  label: 'RQ status admin route',
  redashPath: '/api/admin/queries/rq_status',
  routeUrl: 'http://localhost/api/admin/queries/rq-status',
  upstreamBody: { queues: [{ name: 'queries', started: [], queued: 3 }], workers: [] },
  loadRoute: async () => {
    // Fresh modules per case so src/lib/env.ts re-reads the env this sets.
    vi.resetModules()
    return import('./route')
  },
})
