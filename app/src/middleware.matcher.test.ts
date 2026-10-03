import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from '@/middleware'

describe('which requests reach the middleware', () => {
  it('skips map geometry, so a host page or an anonymous embed can load it without a session', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/geo/world-countries.geojson' })).toBe(false)
  })

  it('still runs for pages', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/dashboards/4' })).toBe(true)
  })
})
