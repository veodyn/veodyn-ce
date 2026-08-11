import { describe, expect, it } from 'vitest'
import {
  dashboardPublicPath,
  embedPublicPath,
  publicLinkUrl,
  shareToken,
} from '@/lib/public-links'

describe('public link paths', () => {
  // The segments are the other way round from Redash's own /public/dashboards/
  // <token>, which is the reason a passed-through public_url is wrong twice
  // over: wrong host and wrong path.
  it('names this product routes, not the Redash ones', () => {
    expect(dashboardPublicPath('abc')).toBe('/dashboards/public/abc')
    expect(embedPublicPath('abc')).toBe('/embed/public/abc')
  })

  it('builds an absolute URL on the origin the reader is already on', () => {
    expect(publicLinkUrl('/dashboards/public/abc')).toBe(
      `${window.location.origin}/dashboards/public/abc`
    )
  })
})

describe('shareToken', () => {
  it('prefers api_key, which is what Redash sends alongside public_url', () => {
    expect(shareToken({ api_key: 'tok', public_url: 'http://redash/public/dashboards/other' })).toBe(
      'tok'
    )
  })

  it('falls back to the last segment of public_url', () => {
    expect(shareToken({ api_key: null, public_url: 'http://flow-dev-redash/public/dashboards/xyz' }))
      .toBe('xyz')
  })

  it('ignores a query string, a fragment and a trailing slash', () => {
    expect(shareToken({ public_url: 'https://h/public/dashboards/xyz/?a=1#top' })).toBe('xyz')
  })

  it('returns null when there is nothing to build a link from', () => {
    expect(shareToken({ api_key: null, public_url: null })).toBeNull()
    expect(shareToken({})).toBeNull()
    // A URL with no token in it yields null rather than a segment that looks
    // like one: no link at all is honest, a wrong link is not.
    expect(shareToken({ public_url: 'https://h/' })).toBeNull()
  })
})
