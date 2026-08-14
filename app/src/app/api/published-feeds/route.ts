/** The binding collection. Forwarding rules live in ./forward.ts. */

import { forward } from './forward'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return forward(request, '/published-feeds')
}

export async function POST(request: Request) {
  const body = await request.text()
  return forward(request, '/published-feeds', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })
}
