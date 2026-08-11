import { NextResponse } from 'next/server'
import { z } from 'zod'
import { mockGenerateSql } from '@/lib/ai-mock'
import { config } from '@/lib/config'
import { env } from '@/lib/env'
import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import { requireSession } from '@/lib/redash-server'
import type { GenerateSqlRequest, GenerateSqlResponse } from '@/types/ai'

export const dynamic = 'force-dynamic'

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 256 * 1024

const generateSqlRequestSchema: z.ZodType<GenerateSqlRequest> = z
  .object({
    prompt: z.string().min(1).max(10_000),
    dataset: z
      .object({
        table: z.string().min(1).max(255),
        columns: z
          .array(
            z
              .object({
                name: z.string().min(1).max(255),
                type: z.string().min(1).max(128),
                description: z.string().max(4_000).optional(),
              })
              .strict()
          )
          .max(500),
      })
      .strict(),
    currentSql: z.string().max(50_000).optional(),
  })
  .strict()

// The provider's success shape. Anything else (an empty 200, an error payload,
// extra provider-internal fields) is refused so only these two canonical fields
// ever reach the browser.
const generateSqlResponseSchema = z.object({
  sql: z.string().min(1).max(50_000),
  rationale: z.string().max(20_000),
})

function errorResponse(error: AppError, status: number): NextResponse {
  return NextResponse.json({ error: error.message, id: error.id }, { status })
}

function invalidRequest(context: Record<string, unknown> = {}): AppError {
  return new AppError(ErrorIds.AI_SPEC_INVALID, 'invalid generate SQL request', context)
}

// One classified failure for every transport / provider / response problem, so
// the browser never learns the endpoint, the key, or the provider's own body.
function providerFailed(): AppError {
  return new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI generation failed')
}

function noSession(): AppError {
  return new AppError(ErrorIds.AUTH_NO_SESSION, 'Sign in to use AI generation')
}

function declaredBodyLength(request: Request): number | null {
  const value = request.headers.get('content-length')
  if (value === null) return null
  if (!/^\d+$/.test(value)) throw invalidRequest({ reason: 'invalid content length' })
  return Number(value)
}

async function readCappedStream(body: ReadableStream<Uint8Array>, max: number): Promise<string> {
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

async function readRequestText(request: Request): Promise<string> {
  const declaredLength = declaredBodyLength(request)
  if (declaredLength !== null && declaredLength > MAX_REQUEST_BYTES) {
    throw invalidRequest({ reason: 'body too large' })
  }
  if (request.body === null) throw invalidRequest({ reason: 'missing body' })
  try {
    return await readCappedStream(request.body, MAX_REQUEST_BYTES)
  } catch (error) {
    if (isAppError(error) && error.id === ErrorIds.AI_REQUEST_FAILED) {
      throw invalidRequest({ reason: 'body too large' })
    }
    throw error
  }
}

async function parseRequest(request: Request): Promise<GenerateSqlRequest> {
  let text: string
  try {
    text = await readRequestText(request)
  } catch (error) {
    if (isAppError(error)) throw error
    throw invalidRequest({ reason: 'unreadable body' })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw invalidRequest({ reason: 'malformed JSON' })
  }

  const result = generateSqlRequestSchema.safeParse(parsed)
  if (!result.success) {
    throw invalidRequest({ reason: 'invalid body shape' })
  }
  return result.data
}

// The caller's own app session cookie value, or null. Same credential the
// session check and the admin gate key off; presence is the floor, and in real
// mode requireSession validates it against Redash.
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

// To the AI endpoint we send ONLY these headers. The endpoint may be a third
// party, so the browser's cookie (session, csrf_token, redash_api_key) and the
// caller's own authorization are never forwarded: only the server-side AI key.
// This is where the AI relay must differ from the KPI/catalog proxies, which
// forward the cookie to a same-trust-domain backend.
function providerHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  }
  if (env.VEODYN_AI__KEY) {
    headers.authorization = `Bearer ${env.VEODYN_AI__KEY}`
  }
  return headers
}

async function callProvider(
  request: Request,
  payload: GenerateSqlRequest
): Promise<NextResponse> {
  const endpoint = config.ai.endpoint
  if (!endpoint) {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI provider unavailable'), 503)
  }

  let upstream: Response
  try {
    upstream = await fetch(`${endpoint.replace(/\/+$/, '')}/generate-sql`, {
      method: 'POST',
      signal: request.signal,
      headers: providerHeaders(),
      body: JSON.stringify(payload),
    })
  } catch {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI provider unreachable'), 502)
  }

  // Discard the provider's own body on any non-ok status: an error payload can
  // echo the provider's authorization header or endpoint URL back to the client.
  if (!upstream.ok || upstream.body === null) {
    return errorResponse(providerFailed(), 502)
  }

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

  const result = generateSqlResponseSchema.safeParse(parsed)
  if (!result.success) {
    return errorResponse(providerFailed(), 502)
  }

  const canonical: GenerateSqlResponse = {
    sql: result.data.sql,
    rationale: result.data.rationale,
  }
  return NextResponse.json(canonical)
}

export async function POST(request: Request) {
  // 1. The disabled gate is first: an instance with AI off answers 403 before
  //    anything else, and never reveals whether it would have had a session.
  if (!config.ai.enabled) {
    return errorResponse(
      new AppError(ErrorIds.AUTH_FORBIDDEN, 'AI is disabled for this instance'),
      403
    )
  }

  // 2. Parse and validate the request body (generic 400 on anything malformed).
  let payload: GenerateSqlRequest
  try {
    payload = await parseRequest(request)
  } catch (error) {
    if (isAppError(error)) return errorResponse(invalidRequest(error.context), 400)
    return errorResponse(invalidRequest(), 400)
  }

  // 3. Authenticate the caller BEFORE running the mock or contacting the
  //    provider. An anonymous caller must not spend the instance AI quota.
  const cookieHeader = request.headers.get('cookie')
  if (!sessionCookieValue(cookieHeader)) {
    return errorResponse(noSession(), 401)
  }
  if (env.NEXT_PUBLIC_REDASH_URL) {
    // Real mode: validate the session against Redash, the same round-trip the
    // session check and the admin gate use.
    const session = await requireSession(cookieHeader, request.signal)
    if (!session) {
      return errorResponse(noSession(), 401)
    }
  }

  // 4. Demo/mock mode (no real backend configured): deterministic mock so the
  //    surface is demoable without a live model.
  if (!env.NEXT_PUBLIC_REDASH_URL) {
    try {
      return NextResponse.json(mockGenerateSql(payload))
    } catch (error) {
      if (isAppError(error)) return errorResponse(invalidRequest(error.context), 400)
      return errorResponse(providerFailed(), 500)
    }
  }

  // 5. Real mode: proxy the configured provider with the server-only key.
  return callProvider(request, payload)
}
