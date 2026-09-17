import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import type { FeatureDescriptor } from '@/features/types'

function ReviewQueueStub() {
  return <p>Waiting for your review: 2 messages</p>
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    messages: {
      id: 'messages',
      nav: [],
      routes: [],
      slots: { 'home.reviewQueue': async () => ({ default: ReviewQueueStub }) },
    },
  }
  return { FEATURES }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock('@/hooks/use-queries', () => ({
  useFavoriteQueries: () => ({ data: { results: [] } }),
  useRecentQueries: () => ({ data: { results: [] } }),
}))
vi.mock('@/hooks/use-dashboards', () => ({
  useFavoriteDashboards: () => ({ data: { results: [] } }),
}))
vi.mock('@/components/home/assistant-widget', () => ({
  AssistantWidget: () => null,
}))
vi.mock('@/hooks/use-catalog', () => ({
  useDomainHubs: vi.fn(() => ({ data: [] })),
  useCatalog: vi.fn(() => ({ data: [] })),
}))

import HomePage from '@/app/page'

describe('the Home review queue slot', () => {
  it('renders the contributed queue', async () => {
    renderWithProviders(<HomePage />)

    expect(await screen.findByText('Waiting for your review: 2 messages')).toBeInTheDocument()
  })
})
