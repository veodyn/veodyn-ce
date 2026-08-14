// The publishedFeed.blockedAttribution seam on a blocked attempt row.
//
// A separate file from any plain rendering test of AttemptHistory, following
// the same reason feed-address.slot.test.tsx gives: this file mocks the
// registry at module scope, so it needs to be the only thing that runs
// against that mock.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AttemptHistory } from './attempt-history'
import type { PublishAttempt } from '@/types/published-feed'
import type { FeatureDescriptor } from '@/features/types'

/** Whatever a feature puts in the publishedFeed.blockedAttribution slot, standing in for it. */
function AttributionStub({ slug, attemptId }: { slug: string; attemptId: number }) {
  return (
    <p>
      Attempt {attemptId} on {slug}: query returned no rows
    </p>
  )
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    health: {
      id: 'health',
      nav: [],
      routes: [],
      slots: { 'publishedFeed.blockedAttribution': async () => ({ default: AttributionStub }) },
    },
  }
  return { FEATURES }
})

const BLOCKED: PublishAttempt = {
  attemptId: 7,
  bindingRevision: 2,
  queryResultId: 500,
  decision: 'blocked',
  reason: '1 conformance error(s)',
  findings: [{ ruleId: 'E003', severity: 'ERROR', title: 'bad trip_id', locator: 'entity 0' }],
  enabledRules: ['E003'],
  isCurrent: false,
  createdAt: new Date().toISOString(),
}

const PUBLISHED: PublishAttempt = {
  attemptId: 8,
  bindingRevision: 2,
  queryResultId: 600,
  decision: 'published',
  reason: '',
  findings: [],
  enabledRules: ['E003'],
  isCurrent: true,
  createdAt: new Date().toISOString(),
}

describe('the blocked-attempt attribution slot', () => {
  it('renders the contributed attribution, with the attempt id and the feed slug', async () => {
    render(<AttemptHistory attempts={[BLOCKED]} slug="vehicles-live" />)

    expect(
      await screen.findByText('Attempt 7 on vehicles-live: query returned no rows')
    ).toBeInTheDocument()
  })

  it('never renders the slot for an attempt that is not blocked', () => {
    render(<AttemptHistory attempts={[PUBLISHED]} slug="vehicles-live" />)

    expect(screen.queryByText(/query returned no rows/)).not.toBeInTheDocument()
  })
})
