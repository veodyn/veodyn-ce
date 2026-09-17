import { beforeEach, describe, expect, it, vi } from 'vitest'

const instance = { connectors: false }

vi.mock('@/lib/config', () => ({
  config: {
    get connectors() {
      return { enabled: instance.connectors }
    },
  },
}))

vi.mock('@/app/api/published-feeds/forward', () => ({
  sidecarBase: () => 'http://sidecar.test',
  forwardedHeaders: () => ({ accept: 'application/json' }),
}))

const { forward } = await import('./forward')

beforeEach(() => {
  instance.connectors = false
  vi.restoreAllMocks()
})

function request(): Request {
  return new Request('http://app.test/api/connectors')
}

describe('the connectors proxy', () => {
  it('answers 404 and reaches no backend while the switch is off', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch')

    const response = await forward(request(), '/connectors')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ errorId: 'E_API_002' })
    expect(fetched).not.toHaveBeenCalled()
  })

  it('forwards to the sidecar once the switch is on', async () => {
    instance.connectors = true
    const fetched = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }))

    const response = await forward(request(), '/connectors')

    expect(response.status).toBe(200)
    expect(fetched).toHaveBeenCalledWith('http://sidecar.test/connectors', expect.anything())
  })
})
