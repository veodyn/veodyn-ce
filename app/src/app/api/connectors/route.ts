import { forward } from './forward'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return forward(request, '/connectors')
}

export async function POST(request: Request) {
  const body = await request.text()
  return forward(request, '/connectors', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  })
}
