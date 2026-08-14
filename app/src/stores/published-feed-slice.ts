import type { StateCreator } from 'zustand'
import { mockPublishedFeeds, mockPublishAttempts } from '@/lib/mock-data'
import type { PublishAttempt, PublishedFeed, PublishedFeedInput } from '@/types/published-feed'
import type { MockDataState } from './mock-data-store'

// Mock mode issues no request at all, so without this slice every page in
// /connect/feeds is blank in dev and in both demo packs.
export interface PublishedFeedSlice {
  publishedFeeds: PublishedFeed[]
  publishAttempts: Record<string, PublishAttempt[]>
  createPublishedFeed: (input: PublishedFeedInput) => PublishedFeed
  updatePublishedFeed: (slug: string, input: PublishedFeedInput) => PublishedFeed
  deletePublishedFeed: (slug: string) => void
  recordPublishAttempt: (slug: string) => PublishAttempt
}

const nextAttemptId = (existing: PublishAttempt[]) =>
  existing.reduce((highest, attempt) => Math.max(highest, attempt.attemptId), 0) + 1

export const createPublishedFeedSlice: StateCreator<MockDataState, [], [], PublishedFeedSlice> = (
  set,
  get
) => ({
  publishedFeeds: [...mockPublishedFeeds],
  publishAttempts: { ...mockPublishAttempts },

  createPublishedFeed: (input) => {
    const feed: PublishedFeed = { ...input, revision: 1, bindingState: 'ok' }
    set((s) => ({ publishedFeeds: [...s.publishedFeeds, feed] }))
    return feed
  },

  updatePublishedFeed: (slug, input) => {
    const existing = get().publishedFeeds.find((f) => f.slug === slug)
    const feed: PublishedFeed = {
      ...input,
      revision: (existing?.revision ?? 0) + 1,
      bindingState: 'ok',
    }
    // The revision bump takes the feed off the air, exactly as the endpoint
    // does, so mock mode shows the same dark window the real one produces.
    set((s) => ({
      publishedFeeds: s.publishedFeeds.map((f) => (f.slug === slug ? feed : f)),
      publishAttempts: {
        ...s.publishAttempts,
        [slug]: (s.publishAttempts[slug] ?? []).map((a) => ({ ...a, isCurrent: false })),
      },
    }))
    return feed
  },

  deletePublishedFeed: (slug) =>
    set((s) => ({
      publishedFeeds: s.publishedFeeds.filter((f) => f.slug !== slug),
      publishAttempts: Object.fromEntries(
        Object.entries(s.publishAttempts).filter(([key]) => key !== slug)
      ),
    })),

  recordPublishAttempt: (slug) => {
    const existing = get().publishAttempts[slug] ?? []
    const feed = get().publishedFeeds.find((f) => f.slug === slug)
    const attempt: PublishAttempt = {
      attemptId: nextAttemptId(existing),
      bindingRevision: feed?.revision ?? 1,
      queryResultId: 500 + existing.length,
      decision: 'published',
      reason: '',
      findings: [],
      enabledRules: ['E003'],
      isCurrent: true,
      createdAt: new Date().toISOString(),
    }
    set((s) => ({
      publishAttempts: {
        ...s.publishAttempts,
        [slug]: [attempt, ...(s.publishAttempts[slug] ?? []).map((a) => ({ ...a, isCurrent: false }))],
      },
    }))
    return attempt
  },
})
