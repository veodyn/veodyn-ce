/**
 * What this deployment's feed entity registry holds. See ../forward.ts for
 * the forwarding rules: unlike ../public/feeds/[slug], this endpoint requires
 * an identity (any org member, per feed_capabilities.py), not the admin gate
 * the rest of the collection needs, so it forwards the caller's own
 * credentials the same way every other published-feeds proxy route does.
 *
 * A static segment sibling to the [slug] dynamic route next door. Next
 * resolves a static segment ahead of a dynamic one, so GET
 * /api/published-feeds/capabilities reaches this file rather than being
 * swallowed as slug="capabilities" by ../[slug]/route.ts. Verified by
 * route.test.ts hitting this path directly and by `pnpm build`'s route
 * listing, which shows both as distinct entries. This is the frontend mirror
 * of the ordering fix feed_capabilities.py documents on the FastAPI side,
 * where the same collision is real and had to be solved by registration
 * order instead.
 */

import { forward } from '../forward'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return forward(request, '/published-feeds/capabilities')
}
