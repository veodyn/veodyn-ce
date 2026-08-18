/**
 * What this deployment's feed entity registry holds. Requires an identity (any
 * org member, per feed_capabilities.py), not the admin gate the rest of the
 * collection needs, and forwards the caller's own credentials via ../forward.ts
 * like every other published-feeds route.
 *
 * Next resolves this static segment ahead of the ../[slug] dynamic route, so
 * the path is not swallowed as slug="capabilities". route.test.ts hits it
 * directly. feed_capabilities.py solves the same collision by registration
 * order on the FastAPI side.
 */

import { forward } from '../forward'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return forward(request, '/published-feeds/capabilities')
}
