import type { StateCreator } from 'zustand'
import { mockFeeds } from '@/lib/mock-data'
import { cadenceLabel } from '@/lib/feed-status'
import type { Feed } from '@/types/feed'
import type { MockDataState } from './mock-data-store'

// The feed slice of the mock data store, split out of mock-data-store.ts to
// keep that file under the repo's file-size limit, the same way the KPI and
// report slices were. It is a zustand slice, not a separate store: nothing here
// reads another collection today, but a feed's cadence and its alert are the
// mock stand-in for the same Redash schedule the query slice describes, so they
// belong in the same state object.
//
// Community, unlike the KPI and report slices beside it: feeds are a community
// surface (/feed-health), and the fixtures come from the pack directly rather
// than through the mock contribution seam.
export interface FeedSlice {
  feeds: Feed[]
  setFeedExpectation: (feedId: string, seconds: number | null) => void
  setFeedAlert: (feedId: string, armed: boolean) => void
}

export const createFeedSlice: StateCreator<MockDataState, [], [], FeedSlice> = (set) => ({
  feeds: [...mockFeeds],

  setFeedExpectation: (feedId, seconds) =>
    set((s) => ({
      feeds: s.feeds.map((feed) =>
        feed.id === feedId
          ? {
              ...feed,
              // The label is recomputed rather than stored twice, so the two can
              // never disagree, and cleared falls back to 'not scheduled'
              // because mock feeds carry no Redash schedule to return to.
              cadence: seconds == null ? 'not scheduled' : cadenceLabel(seconds),
              cadenceSource: seconds == null ? 'none' : 'declared',
              expectedIntervalSeconds: seconds,
            }
          : feed
      ),
    })),

  setFeedAlert: (feedId, armed) =>
    set((s) => ({
      feeds: s.feeds.map((feed) =>
        // A stand-in id, because mock mode has no Redash to answer with a real
        // one. Only its presence is ever read.
        feed.id === feedId ? { ...feed, alertId: armed ? 1 : null } : feed
      ),
    })),
})
