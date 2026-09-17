import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/ai-proxy'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { parseFrame, TERMINAL_EVENTS } from './frames'
import { chatGate, chatHeaders } from './relay'
import { withSubjectCookie } from './subject'

export const MAX_FRAME_BYTES = 64 * 1024
export const MAX_STREAM_BYTES = 4 * 1024 * 1024
const LAST_EVENT_ID = /^[0-9]+-[0-9]+$/

export const INVALID_STREAM_FRAME = `event: error\ndata: ${JSON.stringify({
  id: ErrorIds.AI_CHAT_STREAM_INVALID,
  message: 'The data chat sent something unexpected.',
})}\n\n`

interface RawEvent {
  id: string | null
  event: string | null
  data: string[]
  comment: boolean
}

function readEvent(block: string): RawEvent {
  const raw: RawEvent = { id: null, event: null, data: [], comment: false }
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) {
      raw.comment = true
      continue
    }
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
    if (field === 'id') raw.id = value
    else if (field === 'event') raw.event = value
    else if (field === 'data') raw.data.push(value)
  }
  return raw
}

export type FrameOutcome = { kind: 'forward'; text: string; terminal: boolean } | { kind: 'skip' } | { kind: 'invalid' }

export function checkEventBlock(block: string): FrameOutcome {
  if (new TextEncoder().encode(block).byteLength > MAX_FRAME_BYTES) return { kind: 'invalid' }
  const raw = readEvent(block)
  if (raw.event === null) return raw.comment ? { kind: 'forward', text: ': keep-alive\n\n', terminal: false } : { kind: 'skip' }
  if (raw.id !== null && !LAST_EVENT_ID.test(raw.id)) return { kind: 'invalid' }
  let data: unknown
  try {
    data = JSON.parse(raw.data.join('\n'))
  } catch {
    return { kind: 'invalid' }
  }
  const frame = parseFrame(raw.event, data, raw.id)
  if (frame === null) return { kind: 'invalid' }
  const head = frame.id ? `id: ${frame.id}\n` : ''
  return {
    kind: 'forward',
    text: `${head}event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`,
    terminal: TERMINAL_EVENTS.has(frame.event),
  }
}

export function validatedEventStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = upstream.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''
  let total = 0
  let done = false

  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>, tail?: string) => {
    done = true
    if (tail) controller.enqueue(encoder.encode(tail))
    controller.close()
    await reader.cancel().catch(() => undefined)
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (!done) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const outcome = checkEventBlock(block)
          if (outcome.kind === 'invalid') return finish(controller, INVALID_STREAM_FRAME)
          if (outcome.kind === 'skip') continue
          controller.enqueue(encoder.encode(outcome.text))
          if (outcome.terminal) return finish(controller)
          return
        }
        if (new TextEncoder().encode(buffer).byteLength > MAX_FRAME_BYTES) {
          return finish(controller, INVALID_STREAM_FRAME)
        }
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch {
          return finish(controller, INVALID_STREAM_FRAME)
        }
        if (chunk.done) return finish(controller)
        total += chunk.value.byteLength
        if (total > MAX_STREAM_BYTES) return finish(controller, INVALID_STREAM_FRAME)
        buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, '\n')
      }
    },
    async cancel() {
      done = true
      await reader.cancel().catch(() => undefined)
    },
  })
}

export async function relayChatStream(request: Request, turnId: string): Promise<NextResponse> {
  const gate = await chatGate(request)
  if (gate instanceof NextResponse) return gate
  const headers = chatHeaders(gate.subject, 'text/event-stream')
  const lastEventId = request.headers.get('last-event-id')
  if (lastEventId && LAST_EVENT_ID.test(lastEventId)) headers['last-event-id'] = lastEventId

  let upstream: Response
  try {
    upstream = await fetch(`${gate.endpoint}/chat/turns/${turnId}/stream`, {
      method: 'GET',
      signal: request.signal,
      headers,
    })
  } catch {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'The data chat is unreachable'), 502)
  }
  if (upstream.status === 404) {
    return errorResponse(new AppError(ErrorIds.API_NOT_FOUND, 'No such conversation'), 404)
  }
  if (!upstream.ok || upstream.body === null) {
    return errorResponse(new AppError(ErrorIds.AI_REQUEST_FAILED, 'The data chat stream failed'), 502)
  }
  const response = new NextResponse(validatedEventStream(upstream.body), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  })
  return withSubjectCookie(response, gate.subject)
}
