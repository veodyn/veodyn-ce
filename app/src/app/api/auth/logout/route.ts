/**
 * Logout — notifies Redash (best-effort) and clears our origin's cookies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { REDASH_URL, redashFetch } from '@/lib/redash-server'
import { COOKIE_SECURE } from '@/lib/cookie-attrs'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (REDASH_URL) {
    try {
      // Redash's logout is a GET at the root path
      await redashFetch('/logout', { cookie: request.headers.get('cookie') })
    } catch {
      // Best-effort — clear our cookies regardless
    }
  }

  const res = NextResponse.json({ message: 'Logged out.' })
  // `secure` matches the set sites. A browser matches a cookie for overwrite on
  // (name, domain, path) and not on this attribute, so logout would clear the
  // cookies either way; carrying it keeps all six writes reading the same, so
  // nobody has to work out whether the difference was deliberate.
  const expire = { path: '/', sameSite: 'lax', secure: COOKIE_SECURE, maxAge: 0 } as const
  res.cookies.set('session', '', { ...expire, httpOnly: true })
  res.cookies.set('csrf_token', '', { ...expire, httpOnly: false })
  res.cookies.set('redash_api_key', '', { ...expire, httpOnly: true })
  return res
}
