/**
 * Outdated scheduled queries: proxies /api/admin/queries/outdated.
 *
 * The gate is deliberately not written here. proxyWithInternalKey derives it
 * from the path, against INTERNAL_KEY_ENDPOINTS in src/lib/redash-server.ts,
 * which mirrors Redash's own decorator (@require_super_admin on this one).
 * Read the rule beside that table before adding a route next to this one.
 */

import type { NextRequest } from 'next/server'
import { proxyWithInternalKey } from '@/lib/redash-admin-proxy'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  return proxyWithInternalKey(request, '/api/admin/queries/outdated')
}
