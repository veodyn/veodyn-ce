import { describe, expect, it } from 'vitest'
import { isSameOriginSignIn } from './sign-in-origin'

function signIn(headers: Record<string, string>) {
  return new Request('http://app.example/api/auth/login', { method: 'POST', headers, body: '{}' })
}

const JSON_TYPE = { 'content-type': 'application/json' }

describe('isSameOriginSignIn', () => {
  it('accepts the app own fetch', () => {
    expect(
      isSameOriginSignIn(
        signIn({ ...JSON_TYPE, host: 'app.example', origin: 'https://app.example', 'sec-fetch-site': 'same-origin' })
      )
    ).toBe(true)
  })

  it('accepts a JSON request with no browser metadata, as server-side callers and tests send', () => {
    expect(isSameOriginSignIn(signIn(JSON_TYPE))).toBe(true)
  })

  it('refuses a form post, whatever its encoding', () => {
    expect(isSameOriginSignIn(signIn({ 'content-type': 'text/plain' }))).toBe(false)
    expect(isSameOriginSignIn(signIn({ 'content-type': 'application/x-www-form-urlencoded' }))).toBe(false)
    expect(isSameOriginSignIn(signIn({}))).toBe(false)
  })

  it('refuses a request the browser marks cross-site or same-site', () => {
    expect(isSameOriginSignIn(signIn({ ...JSON_TYPE, 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(isSameOriginSignIn(signIn({ ...JSON_TYPE, 'sec-fetch-site': 'same-site' }))).toBe(false)
  })

  it('refuses an origin that is not the host serving the request', () => {
    expect(isSameOriginSignIn(signIn({ ...JSON_TYPE, host: 'app.example', origin: 'https://other.example' }))).toBe(false)
    expect(isSameOriginSignIn(signIn({ ...JSON_TYPE, host: 'app.example', origin: 'null' }))).toBe(false)
  })

  it('compares against the forwarded host when an ingress sets one', () => {
    expect(
      isSameOriginSignIn(
        signIn({ ...JSON_TYPE, host: 'frontend:3000', 'x-forwarded-host': 'app.example', origin: 'https://app.example' })
      )
    ).toBe(true)
  })
})
