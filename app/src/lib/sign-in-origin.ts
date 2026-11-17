import { NextResponse } from 'next/server'

const SAME_ORIGIN_FETCH = 'same-origin'

function servedHost(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-host')
  if (forwarded) return forwarded.split(',')[0].trim().toLowerCase()
  return request.headers.get('host')?.toLowerCase() ?? null
}

function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase()
  } catch {
    return null
  }
}

export function isSameOriginSignIn(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) return false

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== SAME_ORIGIN_FETCH) return false

  const origin = request.headers.get('origin')
  if (origin !== null) {
    const host = servedHost(request)
    if (host === null || originHost(origin) !== host) return false
  }
  return true
}

export function crossSiteSignInResponse(): NextResponse {
  return NextResponse.json({ message: 'Sign-in must come from this site.' }, { status: 403 })
}
