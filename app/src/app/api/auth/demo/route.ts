import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { env } from '@/lib/env'
import { redashFormLogin } from '@/lib/redash-login'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { persona: personaId } = body as { persona?: string }

  const personas = config.demo.personas
  if (personas.length === 0) {
    return NextResponse.json(
      { message: 'Demo sign-in is not enabled on this instance.' },
      { status: 404 }
    )
  }

  const persona = personas.find((p) => p.id === personaId)
  if (!persona) {
    return NextResponse.json({ message: 'Unknown demo persona.' }, { status: 400 })
  }

  if (!env.DEMO_LOGIN_PASSWORD) {
    return NextResponse.json(
      { message: 'DEMO_LOGIN_PASSWORD not configured.' },
      { status: 503 }
    )
  }

  return redashFormLogin(persona.email, env.DEMO_LOGIN_PASSWORD)
}
