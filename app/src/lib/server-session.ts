/**
 * Reads the caller's Redash session on the SERVER, during the render of the
 * root layout, so the browser is handed an app that already knows who it is.
 *
 * Why this exists. The session used to be fetched from a `useEffect` in
 * SessionProvider, which put three round trips in front of the first byte of
 * page data: download the bundle, hydrate, ask /api/auth/session, and only then
 * let the page mount and fire its own queries. The whole app was replaced by
 * the words "Loading session..." for the middle two. The cookie that answers
 * the question is already on the request that renders the layout, and
 * src/middleware.ts already reads it to decide whether to serve this page at
 * all, so the answer can travel with the HTML instead.
 *
 * This is a read. It deliberately does NOT do the `redash_api_key` self-heal
 * that GET /api/auth/session performs, because a server component cannot set a
 * cookie. `needsApiKeyHeal` reports the condition instead, and SessionProvider
 * fires that route in the background, off the critical path, only when it is
 * true.
 */

import { cookies, headers } from 'next/headers'
import { REDASH_URL, redashFetch } from '@/lib/redash-server'
import { PUBLIC_ROUTE_HEADER } from '@/middleware'
import type { InitialSession, SessionPayload } from '@/stores/auth-identity'

export async function readServerSession(): Promise<InitialSession> {
  // The same value USE_REAL_API reads on the client, so the server and the app
  // agree on which mode they are in. In mock mode there is nothing to ask.
  if (!process.env.NEXT_PUBLIC_REDASH_URL || !REDASH_URL) return null

  const requestHeaders = await headers()

  // A share link, an embed, or an invite. Nothing on those routes reads the
  // session, so asking Redash would put a round trip in front of HTML that
  // will not use the answer. `null` rather than `anonymous` because this is not
  // a claim about the reader: a signed-in person opening a share link still
  // gets their own chrome once the client asks for itself.
  if (requestHeaders.get(PUBLIC_ROUTE_HEADER) === '1') return null

  const cookieStore = await cookies()
  if (!cookieStore.get('session')?.value) return { status: 'anonymous' }

  try {
    // The whole cookie header, not just `session`: Redash wants its csrf_token
    // alongside, and this is the same string the API route forwards.
    const cookieHeader = requestHeaders.get('cookie')
    const res = await redashFetch('/api/session', { cookie: cookieHeader })

    // 401 (no session), 403 (disabled) and 404 (no org) are all settled answers
    // of "not this person", and match what the API route maps to 401.
    if ([401, 403, 404].includes(res.status)) return { status: 'anonymous' }
    if (!res.ok) return null

    const payload = (await res.json()) as SessionPayload
    if (typeof payload?.user?.id !== 'number') return null

    return {
      status: 'authenticated',
      payload,
      needsApiKeyHeal: !cookieStore.get('redash_api_key')?.value,
    }
  } catch {
    // Unreachable or malformed. Not a verdict about the reader, so hand the
    // question back to the client rather than signing them out over it.
    return null
  }
}
