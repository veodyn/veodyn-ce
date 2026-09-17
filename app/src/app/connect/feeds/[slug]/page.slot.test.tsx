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

function DeleteNoticeStub({ slug }: { slug: string }) {
  return <p>Two messages still name {slug}</p>
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    publishing: {
      id: 'publishing',
      nav: [],
      routes: [],
      slots: {
        'publishedFeed.schedule': async () => ({ default: SchedulePanelStub }),
        'publishedFeed.deleteNotice': async () => ({ default: DeleteNoticeStub }),
      },
    },
  }
  return { FEATURES }
})

import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores, signInAsAdmin } from '@/test/utils'
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

describe('the delete notice slot', () => {
  it('lets a feature say what deleting this feed does to the messages that name it', async () => {
    const user = userEvent.setup()
    signInAsAdmin()
    await renderPage()

    await user.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('Two messages still name vehicles-live')).toBeInTheDocument()
  })
})
