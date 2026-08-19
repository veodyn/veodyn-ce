// The publishedFeed.schedule seam on a feed's detail page.
//
// A separate file from page.test.tsx, which mocks the registry as empty at
// module scope, so the filled case needs its own module graph.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import type { FeatureDescriptor } from '@/features/types'

/** Whatever a feature puts in the publishedFeed.schedule slot, standing in for it. */
function SchedulePanelStub({ slug }: { slug: string }) {
  return <p>Publishing {slug} every 5 minutes</p>
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    publishing: {
      id: 'publishing',
      nav: [],
      routes: [],
      slots: { 'publishedFeed.schedule': async () => ({ default: SchedulePanelStub }) },
    },
  }
  return { FEATURES }
})

import { renderWithProviders, resetStores } from '@/test/utils'
import { mockQueries } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import FeedDetailPage from './page'

afterEach(() => {
  resetStores()
  useMockDataStore.setState({ queries: mockQueries })
})

const params = Promise.resolve({ slug: 'vehicles-live' })

async function renderPage() {
  await act(async () => {
    renderWithProviders(<FeedDetailPage params={params} />)
  })
}

describe('the automatic publishing slot', () => {
  it('renders the contributed panel, told which feed is on screen', async () => {
    await renderPage()

    expect(await screen.findByText('Publishing vehicles-live every 5 minutes')).toBeInTheDocument()
  })
})
