/**
 * Verify email: proxies the fork's GET /verify/<token>.
 *
 * Redash's /verify/<token> is not a JSON API: it is a GET that performs the
 * verification as a side effect and renders an HTML page
 * (node/redash/handlers/authentication.py:211). It returns verify.html with
 * status 200 on success, or error.html with status 400 on a bad or expired
 * token. The status code is the entire contract, so this route never parses
 * the HTML body, it only reads the status and translates it into a small
 * JSON payload the client can read.
 *
 * The token comes from a URL a user clicked, so it is untrusted input: it is
 * percent-encoded before being placed in the upstream path and it is never
 * logged.
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
