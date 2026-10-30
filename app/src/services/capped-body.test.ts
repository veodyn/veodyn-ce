import { describe, expect, it } from 'vitest'
import { readCappedJson, ResponseTooLargeError } from './capped-body'

const encoder = new TextEncoder()

function streamedBody(chunks: string[], headers: Record<string, string> = {}) {
  const source = { pulls: 0, cancelled: false }
  const queue = chunks.map((chunk) => encoder.encode(chunk))
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        source.pulls += 1
        const next = queue.shift()
        if (next) controller.enqueue(next)
        else controller.close()
      },
      cancel() {
        source.cancelled = true
      },
    },
    { highWaterMark: 0 }
  )
  return { source, response: new Response(stream, { status: 200, headers }) }
}

describe('readCappedJson', () => {
  it('parses_a_body_under_the_cap', async () => {
    const { response } = streamedBody(['{"query_result":', '{"id":9}}'])
    await expect(readCappedJson(response, 64)).resolves.toEqual({ query_result: { id: 9 } })
  })

  it('a_body_exactly_at_the_cap_is_allowed', async () => {
    const { response } = streamedBody(['[1,2,3]'])
    await expect(readCappedJson(response, 7)).resolves.toEqual([1, 2, 3])
  })

  it('stops_reading_past_the_cap_cancels_the_stream_and_never_parses', async () => {
    const { source, response } = streamedBody(['xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx', 'xxxxxxxx'])
    const failure = await readCappedJson(response, 10).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ResponseTooLargeError)
    expect(failure).toMatchObject({ bytesRead: 16, maxBytes: 10, declaredBytes: null })
    expect(source.cancelled).toBe(true)
    expect(source.pulls).toBe(2)
  })

  it('refuses_from_content_length_without_reading_a_chunk', async () => {
    const { source, response } = streamedBody(['xxxxxxxx'], { 'content-length': '21842609' })
    const failure = await readCappedJson(response, 10).catch((error: unknown) => error)
    expect(failure).toMatchObject({ name: 'ResponseTooLargeError', bytesRead: 0, maxBytes: 10, declaredBytes: 21842609 })
    expect(source.pulls).toBe(0)
    expect(source.cancelled).toBe(true)
  })

  it('a_content_length_that_understates_the_body_is_still_capped_by_the_count', async () => {
    const { source, response } = streamedBody(['xxxxxxxx', 'xxxxxxxx'], { 'content-length': '4' })
    const failure = await readCappedJson(response, 10).catch((error: unknown) => error)
    expect(failure).toMatchObject({ name: 'ResponseTooLargeError', bytesRead: 16, declaredBytes: 4 })
    expect(source.cancelled).toBe(true)
  })

  it('an_abort_mid_read_cancels_the_stream_and_rejects_as_aborted', async () => {
    const controller = new AbortController()
    const source = { cancelled: false }
    const stream = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode('{"a":'))
      },
      cancel() {
        source.cancelled = true
      },
    })
    const pending = readCappedJson(new Response(stream), 1024, controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.cancelled).toBe(true)
  })

  it('an_already_aborted_signal_reads_nothing', async () => {
    const controller = new AbortController()
    controller.abort()
    const { source, response } = streamedBody(['{}'])
    await expect(readCappedJson(response, 64, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.pulls).toBe(0)
    expect(source.cancelled).toBe(true)
  })
})
