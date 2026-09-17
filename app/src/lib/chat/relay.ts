import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'
import {
  MAX_RESPONSE_BYTES,
  errorResponse,
  invalidRequest,
  parseAiRequest,
  providerFailed,
  providerHeaders,
  readCappedStream,
} from '@/lib/ai-proxy'
import { config } from '@/lib/config'
import { env } from '@/lib/env'
import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import { chatIdSchema } from './wire'
import { resolveAiSubject, withSubjectCookie, type SubjectResolution } from './subject'

export const USER_TOKEN_HEADER = 'x-veodyn-user-token'
export const TOOL_RESULT_MAX_BYTES = 256 * 1024
const PASSED_THROUGH = new Set([401, 404, 409, 422, 503])

export interface ChatUpstream {
  endpoint: string
  subject: Extract<SubjectResolution, { ok: true }>
}

export async function chatGate(request: Request): Promise<ChatUpstream | NextResponse> {
  if (!config.ai.enabled || !config.ai.chat) {
    return errorResponse(new AppError(ErrorIds.AUTH_FORBIDDEN, 'The data chat is off on this instance'), 403)
  }
  if (!env.NEXT_PUBLIC_REDASH_URL) {
    return errorResponse(new AppError(ErrorIds.AUTH_FORBIDDEN, 'The data chat needs a live backend'), 403)
  }
  const endpoint = config.ai.endpoint
  if (!endpoint) {
    return errorResponse(new AppError(ErrorIds.AI_CHAT_UNAVAILABLE, 'The data chat is unavailable'), 503)
  }
  const subject = await resolveAiSubject(request)
  if (!subject.ok) return subject.response
  return { endpoint: endpoint.replace(/\/+$/, ''), subject }
}

export function chatHeaders(subject: ChatUpstream['subject'], accept = 'application/json'): Record<string, string> {
  return { ...providerHeaders(), accept, [USER_TOKEN_HEADER]: subject.token }
}

export function chatId(value: string): string | null {
  return chatIdSchema.safeParse(value).success ? value : null
}

export function notFound(): NextResponse {
  return errorResponse(new AppError(ErrorIds.API_NOT_FOUND, 'No such conversation'), 404)
}

function upstreamRefusal(status: number): NextResponse {
  if (!PASSED_THROUGH.has(status)) return errorResponse(providerFailed(), 502)
  const message = status === 409 ? 'The conversation is busy' : 'The data chat refused the request'
  return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, message, { status }), status)
}

export interface ChatJsonRelay<TRequest, TResponse> {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  requestSchema?: ZodType<TRequest>
  responseSchema?: ZodType<TResponse>
  maxRequestBytes?: number
}

export async function relayChatJson<TRequest, TResponse>(
  request: Request,
  relay: ChatJsonRelay<TRequest, TResponse>
): Promise<NextResponse> {
  const gate = await chatGate(request)
  if (gate instanceof NextResponse) return gate

  let body: string | undefined
  if (relay.requestSchema) {
    try {
      const payload = await parseAiRequest(request, relay.requestSchema, 'Invalid chat request', relay.maxRequestBytes)
      body = JSON.stringify(payload)
    } catch (error) {
      const context = isAppError(error) ? error.context : {}
      return errorResponse(invalidRequest('Invalid chat request', context), 400)
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(`${gate.endpoint}/chat/${relay.path}`, {
      method: relay.method,
      signal: request.signal,
      headers: chatHeaders(gate.subject),
      ...(body === undefined ? {} : { body }),
    })
  } catch {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'The data chat is unreachable'), 502)
  }

  if (!upstream.ok) return withSubjectCookie(upstreamRefusal(upstream.status), gate.subject)
  if (upstream.status === 204 || !relay.responseSchema) {
    return withSubjectCookie(new NextResponse(null, { status: 204 }), gate.subject)
  }
  if (upstream.body === null) return errorResponse(providerFailed(), 502)

  try {
    const parsed = relay.responseSchema.safeParse(JSON.parse(await readCappedStream(upstream.body, MAX_RESPONSE_BYTES)))
    if (!parsed.success) return errorResponse(providerFailed(), 502)
    return withSubjectCookie(NextResponse.json(parsed.data, { status: upstream.status }), gate.subject)
  } catch {
    return errorResponse(providerFailed(), 502)
  }
}
