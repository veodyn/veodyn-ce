// The "Draft" marker, the copy it carries, and the header that mounts it.
//
// A draft is listed only for its author and stays readable by link to anyone
// with the data source. Both halves are asserted, because the badge exists to
// say the second half out loud. And the whole thing only exists where the draft
// workflow does.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/utils'
import { QueryDraftBadge, DRAFT_BADGE_EXPLANATION } from './query-draft-badge'
import { QueryEditorHeader } from './query-editor-header'
import type { MockQuery } from '@/lib/mock-data'

// QueryEditorHeader renders QuerySourceMenu for a saved query, which calls
// useRouter and would otherwise throw before any assertion here runs.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/queries/7',
}))

const noop = () => {}

// `features` is one object, so a partial override replaces the whole of it and
// every key it holds has to be named.
function features(queryDrafts: boolean) {
  return { config: { features: { query_snippets: false, query_drafts: queryDrafts } } }
}

function query(overrides: Partial<MockQuery>): MockQuery {
  return {
    id: 7,
    name: 'Rail boardings',
    query: 'select 1',
    tags: [],
    is_favorite: false,
    ...overrides,
  } as unknown as MockQuery
}

function renderHeader(existingQuery: MockQuery, queryDrafts = true) {
  return renderWithProviders(
    <QueryEditorHeader
      existingQuery={existingQuery}
      queryId={existingQuery.id}
      isDirty={false}
      onOpenSchedule={noop}
      onOpenApiKey={noop}
      onOpenEmbed={noop}
      onOpenAddToDashboard={noop}
      onOpenPermissions={noop}
    />,
    features(queryDrafts)
  )
}

describe('QueryDraftBadge', () => {
  it('says Draft and explains what a draft is and is not', () => {
    renderWithProviders(<QueryDraftBadge />)

    expect(screen.getByText('Draft')).toBeInTheDocument()

    // Not only a title attribute: the caveat has to reach a screen reader.
    const explanation = screen.getByText(DRAFT_BADGE_EXPLANATION, { exact: false })
    expect(explanation).toHaveClass('sr-only')
    // The listing half, which is now true: get_queries passes
    // include_drafts=False, so a draft is in its author's list and nobody
    // else's.
    expect(DRAFT_BADGE_EXPLANATION).toMatch(/listed only for you/i)
    // And the caveat, which is the reason the badge exists. The read path never
    // looks at is_draft, so this is not a permission and must not read as one.
    expect(DRAFT_BADGE_EXPLANATION).toMatch(/not a permission/i)
    expect(DRAFT_BADGE_EXPLANATION).toMatch(/open this query by link/i)
    // The old copy said the opposite of the first half and was written against
    // the old backend. It must not come back.
    expect(DRAFT_BADGE_EXPLANATION).not.toMatch(/does not hide the query/i)
  })
})

describe('QueryEditorHeader draft state', () => {
  it('marks a draft query beside its title', () => {
    renderHeader(query({ is_draft: true }))

    expect(screen.getByText('Draft')).toBeInTheDocument()
  })

  it('does not mark a shared query', () => {
    renderHeader(query({ is_draft: false }))

    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })

  it('says nothing about drafts at all with the workflow off', () => {
    // Same query, same is_draft: true. Only the flag differs, so a badge that
    // ignored the flag would pass the first test and fail this one.
    renderHeader(query({ is_draft: true }), false)

    expect(screen.getByText('Rail boardings')).toBeInTheDocument()
    expect(screen.queryByText('Draft')).not.toBeInTheDocument()
  })
})
