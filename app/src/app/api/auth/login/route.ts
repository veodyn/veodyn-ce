import { NextRequest, NextResponse } from 'next/server'
import { redashFormLogin } from '@/lib/redash-login'
import { crossSiteSignInResponse, isSameOriginSignIn } from '@/lib/sign-in-origin'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isSameOriginSignIn(request)) return crossSiteSignInResponse()

  const body = await request.json().catch(() => ({}))
  const { email, password } = body as { email?: string; password?: string }

  if (!email || !password) {
    return NextResponse.json({ message: 'Email and password are required.' }, { status: 400 })
  }

  return redashFormLogin(email, password)
}
