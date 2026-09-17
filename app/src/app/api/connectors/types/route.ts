import { forward } from '../forward'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  return forward(request, '/connectors/types')
}
