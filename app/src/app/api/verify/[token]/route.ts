/**
 * Verify email: proxies the fork's GET /verify/<token>.
 *
 * That endpoint is not a JSON API: it verifies as a side effect and renders
 * HTML, 200 on success and 400 on a bad or expired token
 * (node/redash/handlers/authentication.py:211). The status is the entire
 * contract, so this route reads it and never parses the body.
 *
 * The token comes from a URL a user clicked, so it is untrusted input:
 * percent-encoded into the upstream path, and never logged.
 */
import { NextResponse } from 'next/server'
import { REDASH_URL, redashFetch } from '@/lib/redash-server'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!REDASH_URL) {
    return NextResponse.json({ status: 'error' }, { status: 503 })
  }

  try {
    const res = await redashFetch(`/verify/${encodeURIComponent(token)}`)
    if (res.status === 200) {
      return NextResponse.json({ status: 'verified' })
    }
    if (res.status === 400) {
      return NextResponse.json({ status: 'invalid' }, { status: 400 })
    }
    return NextResponse.json({ status: 'error' }, { status: 502 })
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 502 })
  }
}
