// The publishedFeed.tokenPanel seam on a private feed's address block.
//
// A separate file from feed-address.test.tsx, which asserts the community
// shape with whatever the tree actually has installed. This file mocks the
// registry at module scope, the way annotation-dialog.test.tsx does for
// dashboard.annotationSuggest, so it needs its own file rather than changing
// what every other case in that file renders against.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FeedAddress } from './feed-address'
import type { PublishedFeed } from '@/types/published-feed'
import type { FeatureDescriptor } from '@/features/types'

/** Whatever a feature puts in the publishedFeed.tokenPanel slot, standing in for it. */
function TokenPanelStub({ slug }: { slug: string }) {
  return <p>Issue a token for {slug}</p>
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    tokens: {
      id: 'tokens',
      nav: [],
      routes: [],
      slots: { 'publishedFeed.tokenPanel': async () => ({ default: TokenPanelStub }) },
    },
  }
  return { FEATURES }
})

const PRIVATE_FEED: PublishedFeed = {
  slug: 'private-vehicles',
  revision: 1,
  queryId: 1,
  standard: 'gtfs-rt',
  version: '2.0',
  entity: 'vehicle_positions',
  staticGtfsRef: 'https://example.org/gtfs.zip',
  sourceColumn: null,
  columnMap: {},
  onError: 'block',
  lastGoodMaxAgeSeconds: null,
  visibility: 'private',
  bindingState: 'unknown',
}

describe('the private-feed token panel slot', () => {
  it('renders the contributed panel, with the feed slug and nothing else', async () => {
    render(<FeedAddress feed={PRIVATE_FEED} />)

    expect(await screen.findByText('Issue a token for private-vehicles')).toBeInTheDocument()
  })

  it('never renders the slot on a public feed, which already has an address', () => {
    render(<FeedAddress feed={{ ...PRIVATE_FEED, visibility: 'public' }} />)

    expect(screen.queryByText(/issue a token/i)).not.toBeInTheDocument()
  })
})
