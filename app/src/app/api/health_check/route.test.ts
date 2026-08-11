// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GET } from './route'

describe('health check route', () => {
  it('returns the health payload with status 200', async () => {
    const res = GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
