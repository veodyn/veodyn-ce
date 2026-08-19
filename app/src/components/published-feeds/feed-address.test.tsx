import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedAddress, feedPath } from './feed-address'
import type { PublishedFeed } from '@/types/published-feed'

const FEED: PublishedFeed = {
  slug: 'vehicles-live',
  revision: 3,
  queryId: 1,
  standard: 'gtfs-rt',
  version: '2.0',
  entity: 'vehicle_positions',
  staticGtfsRef: 'https://example.org/gtfs.zip',
  systemInfo: null,
  sourceColumn: null,
  columnMap: { vehicle_id: 'bus', latitude: 'lat', longitude: 'lon' },
  onError: 'block',
  lastGoodMaxAgeSeconds: null,
  visibility: 'public',
  bindingState: 'unknown',
}

describe('the feed address', () => {
  it('shows where a public feed is read, on this instance origin', () => {
    render(<FeedAddress feed={FEED} />)

    const field = screen.getByLabelText('Feed address')
    expect(field).toHaveValue(`${window.location.origin}/api/public/feeds/vehicles-live`)
  })

  it('says a public feed needs no credential and answers only once published', () => {
    render(<FeedAddress feed={FEED} />)

    expect(screen.getByText(/no credential/i)).toBeInTheDocument()
    expect(screen.getByText(/once an attempt has published/i)).toBeInTheDocument()
  })

  it('gives a private feed no address at all', () => {
    // Not a URL that would refuse: a private feed is reached with a token that
    // does not exist yet, so printing one would send someone looking for it.
    render(<FeedAddress feed={{ ...FEED, visibility: 'private' }} />)

    expect(screen.queryByLabelText('Feed address')).not.toBeInTheDocument()
    expect(screen.queryByText(/api\/public\/feeds/)).not.toBeInTheDocument()
    expect(screen.getByText(/no public address/i)).toBeInTheDocument()
  })

  it('escapes a slug into the path rather than interpolating it raw', () => {
    expect(feedPath('a/b')).toBe('/api/public/feeds/a%2Fb')
  })
})
