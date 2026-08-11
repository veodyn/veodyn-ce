// One relay for every AI route: the disabled gate, a size-capped request parse,
// the caller-auth gate, the demo mock, and a provider proxy that sends only the
// server key and validates what comes back. The AI-01 generate-sql route
// established this sequence; the AI-02 routes share it from here so the four of
// them cannot drift apart again (each one was written from an earlier, weaker
// copy of it, which is how the auth gate and the response cap went missing).
import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import { config } from '@/lib/config'
import { env } from '@/lib/env'
import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import { requireSession } from '@/lib/redash-server'

export const MAX_REQUEST_BYTES = 64 * 1024
export const MAX_RESPONSE_BYTES = 256 * 1024

export function errorResponse(error: AppError, status: number): NextResponse {
  return NextResponse.json({ error: error.message, id: error.id }, { status })
}

export function invalidRequest(
  message: string,
  context: Record<string, unknown> = {}
): AppError {
  return new AppError(ErrorIds.AI_SPEC_INVALID, message, context)
}

// One classified failure for every transport / provider / response problem, so
// the browser never learns the endpoint, the key, or the provider's own body.
export function providerFailed(): AppError {
  return new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI generation failed')
}

function noSession(): AppError {
  return new AppError(ErrorIds.AUTH_NO_SESSION, 'Sign in to use AI generation')
}

export async function readCappedStream(
  body: ReadableStream<Uint8Array>,
  max: number
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let size = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > max) {
        await reader.cancel()
        throw providerFailed()
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

// To the AI endpoint we send ONLY these headers. The endpoint may be a third
// party, so the browser's cookie (session, csrf_token, redash_api_key) and the
// caller's own authorization are never forwarded: only the server-side AI key.
// This is where the AI relay must differ from the KPI/catalog proxies, which
// forward the cookie to a same-trust-domain backend.
export function providerHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  }
  if (env.VEODYN_AI__KEY) {
    headers.authorization = `Bearer ${env.VEODYN_AI__KEY}`
  }
  return headers
}

// The caller's own app session cookie value, or null. Presence is the floor,
// and in real mode requireSession validates it against Redash.
function sessionCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === 'session') {
      const value = part.slice(eq + 1).trim()
      return value.length > 0 ? value : null
    }
  }
  return null
}

// Non-null means the caller is refused: an anonymous caller must not read the
// instance's data, spend its AI quota, or learn whether a provider is reachable.
export async function requireAiCaller(request: Request): Promise<NextResponse | null> {
  const cookieHeader = request.headers.get('cookie')
  if (!sessionCookieValue(cookieHeader)) return errorResponse(noSession(), 401)
  if (env.NEXT_PUBLIC_REDASH_URL) {
    const session = await requireSession(cookieHeader, request.signal)
    if (!session) return errorResponse(noSession(), 401)
  }
  return null
}

function declaredBodyLength(request: Request, message: string): number | null {
  const value = request.headers.get('content-length')
  if (value === null) return null
  if (!/^\d+$/.test(value)) {
    throw invalidRequest(message, { reason: 'invalid content length' })
  }
  return Number(value)
}

async function readRequestText(request: Request, message: string): Promise<string> {
  const declaredLength = declaredBodyLength(request, message)
  if (declaredLength !== null && declaredLength > MAX_REQUEST_BYTES) {
    throw invalidRequest(message, { reason: 'body too large' })
  }
  if (request.body === null) throw invalidRequest(message, { reason: 'missing body' })
  try {
    return await readCappedStream(request.body, MAX_REQUEST_BYTES)
  } catch (error) {
    if (isAppError(error) && error.id === ErrorIds.AI_REQUEST_FAILED) {
      throw invalidRequest(message, { reason: 'body too large' })
    }
    throw error
  }
}

export async function parseAiRequest<T>(
  request: Request,
  schema: ZodType<T>,
  message: string
): Promise<T> {
  let text: string
  try {
    text = await readRequestText(request, message)
  } catch (error) {
    if (isAppError(error)) throw error
    throw invalidRequest(message, { reason: 'unreadable body' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw invalidRequest(message, { reason: 'malformed JSON' })
  }

  const result = schema.safeParse(parsed)
  if (!result.success) throw invalidRequest(message, { reason: 'invalid body shape' })
  return result.data
}

export interface AiRelay<TRequest, TResponse> {
  /** Provider path segment, which is also this route's own name. */
  path: string
  /** Null for a GET route: there is no body to read. */
  requestSchema: ZodType<TRequest> | null
  /** The 400 message for anything malformed about the request. */
  invalidMessage: string
  /**
   * The provider's success shape. Anything else (an empty 200, an error
   * payload, a smuggled extra field) is refused, so only canonical fields ever
   * reach the browser.
   */
  responseSchema: ZodType<TResponse>
  mock: (payload: TRequest) => unknown
}

async function callProvider<TRequest, TResponse>(
  request: Request,
  payload: TRequest,
  relay: AiRelay<TRequest, TResponse>
): Promise<NextResponse> {
  const endpoint = config.ai.endpoint
  if (!endpoint) {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI provider unavailable'), 503)
  }

  const isRead = relay.requestSchema === null
  let upstream: Response
  try {
    upstream = await fetch(`${endpoint.replace(/\/+$/, '')}/${relay.path}`, {
      method: isRead ? 'GET' : 'POST',
      signal: request.signal,
      headers: providerHeaders(),
      ...(isRead ? {} : { body: JSON.stringify(payload) }),
    })
  } catch {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI provider unreachable'), 502)
  }

  // Discard the provider's own body on any non-ok status: an error payload can
  // echo the provider's authorization header or endpoint URL back to the client.
  if (!upstream.ok || upstream.body === null) return errorResponse(providerFailed(), 502)

  let text: string
  try {
    text = await readCappedStream(upstream.body, MAX_RESPONSE_BYTES)
  } catch {
    return errorResponse(providerFailed(), 502)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return errorResponse(providerFailed(), 502)
  }

  const result = relay.responseSchema.safeParse(parsed)
  if (!result.success) return errorResponse(providerFailed(), 502)
  return NextResponse.json(result.data)
}

export async function handleAiRelay<TRequest, TResponse>(
  request: Request,
  relay: AiRelay<TRequest, TResponse>
): Promise<NextResponse> {
  // 1. The disabled gate is first: an instance with AI off answers 403 before
  //    anything else, and never reveals whether it would have had a session.
  if (!config.ai.enabled) {
    return errorResponse(
      new AppError(ErrorIds.AUTH_FORBIDDEN, 'AI is disabled for this instance'),
      403
    )
  }

  // 2. Parse and validate the request body (generic 400 on anything malformed).
  let payload = undefined as TRequest
  if (relay.requestSchema !== null) {
    try {
      payload = await parseAiRequest(request, relay.requestSchema, relay.invalidMessage)
    } catch (error) {
      const context = isAppError(error) ? error.context : {}
      return errorResponse(invalidRequest(relay.invalidMessage, context), 400)
    }
  }

  // 3. Authenticate the caller BEFORE running the mock or contacting the
  //    provider. An anonymous caller must not read this instance's data or
  //    spend its AI quota.
  const denied = await requireAiCaller(request)
  if (denied !== null) return denied

  // 4. Demo/mock mode (no real backend configured): deterministic mock so the
  //    surface is demoable without a live model.
  if (!env.NEXT_PUBLIC_REDASH_URL) {
    try {
      return NextResponse.json(relay.mock(payload))
    } catch (error) {
      if (isAppError(error)) {
        return errorResponse(invalidRequest(relay.invalidMessage, error.context), 400)
      }
      return errorResponse(providerFailed(), 500)
    }
  }

  // 5. Real mode: proxy the configured provider with the server-only key.
  return callProvider(request, payload, relay)
}
