// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { publicOrigin } from './public-origin'

function requestWith(headers: Record<string, string>) {
  return new Request('http://0.0.0.0:3000/mcp', { headers })
}

describe('publicOrigin', () => {
  it('builds the origin from the forwarded protocol and host, first value of each', () => {
    const request = requestWith({
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'app.example.com, internal:3000',
      host: '0.0.0.0:3000',
    })
    expect(publicOrigin(request)).toBe('https://app.example.com')
  })

  it('defaults the forwarded protocol to https', () => {
    expect(publicOrigin(requestWith({ 'x-forwarded-host': 'app.example.com' }))).toBe('https://app.example.com')
  })

  it('uses the host header when nothing is forwarded', () => {
    expect(publicOrigin(requestWith({ host: 'app.example.com' }))).toBe('https://app.example.com')
  })

  it('falls back to the request url when there are no host headers', () => {
    expect(publicOrigin(new Request('http://localhost:3000/mcp'))).toBe('http://localhost:3000')
  })
})
