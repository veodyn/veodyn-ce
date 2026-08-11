/**
 * Logout — notifies Redash (best-effort) and clears our origin's cookies.
 */

import { NextRequest, NextResponse } from 'next/server'
import { REDASH_URL, redashFetch } from '@/lib/redash-server'

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
  res.cookies.set('session', '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 })
  res.cookies.set('csrf_token', '', { path: '/', httpOnly: false, sameSite: 'lax', maxAge: 0 })
  res.cookies.set('redash_api_key', '', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 0 })
  return res
}
