// @vitest-environment node
//
// The Redash proxy has to carry a response back byte for byte.
//
// It read every response with `response.text()` (the if/else on content type
// had identical branches), so anything that is not text came back decoded as
// UTF-8. That silently corrupts every binary body Redash can produce: the
// xlsx a query result exports to is the one that matters here, and a corrupt
// spreadsheet does not announce itself, it just fails to open.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const REDASH_URL = 'http://redash.test'

async function loadRoute() {
  vi.resetModules()
  process.env.REDASH_URL = REDASH_URL
  return import('./route')
}

/** A byte sequence that is not valid UTF-8, which is what makes this testable. */
const XLSX_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x80, 0x91])

function request(path: string) {
  // NextRequest, not Request: the handler reads nextUrl.searchParams.
  return new NextRequest(`http://localhost/api/node/${path}`, {
    method: 'GET',
    headers: { cookie: 'session=abc' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a binary response from Redash', () => {
  it('arrives with its bytes intact', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(XLSX_BYTES, {
        status: 200,
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      })
    )

    const { GET } = await loadRoute()
    const res = await GET(request('queries/8/results.xlsx') as never, {
      params: Promise.resolve({ path: ['queries', '8', 'results.xlsx'] }),
    } as never)

    const received = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(received)).toEqual(Array.from(XLSX_BYTES))
  })

  it('keeps the content type so the browser knows what it got', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(XLSX_BYTES, {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      })
    )

    const { GET } = await loadRoute()
    const res = await GET(request('queries/8/results.xlsx') as never, {
      params: Promise.resolve({ path: ['queries', '8', 'results.xlsx'] }),
    } as never)

    expect(res.headers.get('Content-Type')).toBe('application/octet-stream')
  })

  // The filename Redash chose has to survive, or every export lands as
  // "results.xlsx" regardless of which query produced it.
  it('forwards the download filename Redash set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(XLSX_BYTES, {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="Weather history.xlsx"',
        },
      })
    )

    const { GET } = await loadRoute()
    const res = await GET(request('queries/8/results.xlsx') as never, {
      params: Promise.resolve({ path: ['queries', '8', 'results.xlsx'] }),
    } as never)

    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="Weather history.xlsx"')
  })
})

describe('a JSON response', () => {
  it('still comes back as it always did', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 8 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    )

    const { GET } = await loadRoute()
    const res = await GET(request('queries/8') as never, {
      params: Promise.resolve({ path: ['queries', '8'] }),
    } as never)

    expect(await res.json()).toEqual({ id: 8 })
  })
})
