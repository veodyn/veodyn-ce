/**
 * The MCP endpoint. Connect > MCP has always documented this URL; until now it
 * returned 404, so the page presented a copyable client config for a server
 * that did not exist.
 *
 * Transport is Streamable HTTP in its simplest conformant form: the client
 * POSTs JSON-RPC and gets one JSON response back. No SSE stream and no session
 * id, because every method here answers immediately and nothing is pushed.
 *
 * Authentication is the caller's own Redash credential, never the instance's
 * service key. An MCP client sends `Authorization: Key <redash-api-key>`; a
 * browser on this origin has cookies this app's login route set. Exactly ONE
 * credential is chosen and forwarded, and the Cookie header is parsed rather
 * than passed through, so Redash decides what this caller may read using the
 * single identity the caller actually presented. See redash-caller.
 */

import { NextResponse } from 'next/server'
import { REDASH_URL } from '@/lib/redash-server'
import { dispatch } from '@/lib/mcp/dispatch'
import {
  failure,
  JSON_RPC_ERRORS,
  LATEST_PROTOCOL_VERSION,
  parseMessage,
  type JsonRpcResponse,
} from '@/lib/mcp/protocol'
import { hasCredential, resolveCredential } from '@/lib/mcp/redash-caller'

export const dynamic = 'force-dynamic'

const SERVER = { name: 'veodyn', version: '1.0.0' }

// One POST is one turn of a conversation. A batch is for a handful of related
// messages, not for driving the endpoint as a work queue.
const MAX_BATCH_SIZE = 25

function notConfigured() {
  return NextResponse.json(
    {
      error: 'REDASH_URL not configured.',
      detail: 'This instance has no analytics backend, so there is nothing for MCP to read.',
    },
    { status: 503 }
  )
}

function unauthorized() {
  return NextResponse.json(
    {
      error: 'Unauthorized.',
      detail:
        'Send a Veodyn user API key as `Authorization: Key <key>`. Find yours under your profile in the app.',
    },
    { status: 401, headers: { 'WWW-Authenticate': 'Key' } }
  )
}

// Plain Request, not NextRequest: this handler reads headers and a JSON body
// and touches nothing Next adds on top, so the narrower type is the honest one.
export async function POST(request: Request) {
  if (!REDASH_URL) return notConfigured()

  const credential = resolveCredential(
    request.headers.get('authorization'),
    request.headers.get('cookie')
  )
  if (!hasCredential(credential)) return unauthorized()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      failure(null, JSON_RPC_ERRORS.PARSE_ERROR, 'Request body is not valid JSON.'),
      { status: 400 }
    )
  }

  // A client may send one message or a batch. Both are answered in kind, and a
  // batch of nothing but notifications produces no body at all.
  const batch = Array.isArray(payload)
  const messages: unknown[] = batch ? (payload as unknown[]) : [payload]
  if (batch && messages.length === 0) {
    return NextResponse.json(
      failure(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Empty batch.'),
      { status: 400 }
    )
  }
  // Each message can cost several Redash requests, and they run one after the
  // other on this request's clock. Without a cap, one POST carrying a thousand
  // tool calls turns into a thousand calls against the analytics instance.
  if (messages.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      failure(
        null,
        JSON_RPC_ERRORS.INVALID_REQUEST,
        `Batch of ${messages.length} exceeds the limit of ${MAX_BATCH_SIZE}. Send fewer messages per request.`
      ),
      { status: 413 }
    )
  }

  const responses: JsonRpcResponse[] = []
  for (const raw of messages) {
    const message = parseMessage(raw)
    if (!message) {
      responses.push(
        failure(null, JSON_RPC_ERRORS.INVALID_REQUEST, 'Not a JSON-RPC 2.0 request object.')
      )
      continue
    }
    try {
      const response = await dispatch(message, {
        credential,
        server: SERVER,
        // A client that hangs up should not leave this server polling a Redash
        // job on its behalf.
        signal: request.signal,
      })
      if (response) responses.push(response)
    } catch (error) {
      // dispatch already turns tool failures into results, so reaching here
      // means the server itself broke rather than the call.
      responses.push(
        failure(
          message.id ?? null,
          JSON_RPC_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Internal error.'
        )
      )
    }
  }

  // 202 with no body is the correct answer to notifications only.
  if (responses.length === 0) return new Response(null, { status: 202 })
  return NextResponse.json(batch ? responses : responses[0])
}

/**
 * Streamable HTTP allows a GET for a server-initiated SSE stream. This server
 * never initiates anything, and the spec says to answer 405 when the stream is
 * not offered, rather than leaving a connection open that will stay silent.
 */
export function GET() {
  if (!REDASH_URL) return notConfigured()
  return NextResponse.json(
    {
      error: 'Method Not Allowed.',
      detail: `POST JSON-RPC to this URL. Protocol version ${LATEST_PROTOCOL_VERSION}.`,
    },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
