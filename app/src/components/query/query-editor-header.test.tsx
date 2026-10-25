import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { QueryEditorHeader } from './query-editor-header'
import type { MockQuery } from '@/lib/mock-data'

// A saved query renders QuerySourceMenu, which calls useRouter. Without this
// the render throws "expected app router to be mounted" before it reaches
// anything this file is actually asserting on.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/queries/7',
}))

vi.stubEnv('NEXT_PUBLIC_REDASH_URL', 'http://redash.test')

const createThread = vi.hoisted(() => vi.fn())
vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  createThread,
}))

const noop = () => {}

const savedQuery = {
  id: 7,
  name: 'Rail boardings',
  query: 'select 1',
  tags: [],
  is_favorite: false,
} as unknown as MockQuery

function renderHeader(existingQuery: MockQuery | null = null, queryId?: number, isDirty = false) {
  return renderWithProviders(
    <QueryEditorHeader
      existingQuery={existingQuery}
      queryId={queryId}
      isDirty={isDirty}
      onOpenSchedule={noop}
      onOpenApiKey={noop}
      onOpenAddToDashboard={noop}
      onOpenPermissions={noop}
    />,
    { config: { ai: { enabled: true } } }
  )
}

describe('QueryEditorHeader', () => {
  it('gives the page a primary heading, editable in place', () => {
    renderHeader()

    // A new query page must have an h1, not just a clickable span.
    const heading = screen.getByRole('heading', { level: 1, name: 'New Query' })
    expect(heading).toBeInTheDocument()
    // The editable title still lives inside the heading.
    expect(heading).toHaveTextContent('New Query')
  })

  // Home and the sidebar both surface favorites, and the list pages carry a
  // star per row, but a saved query had no way to be starred from the page you
  // are on when you decide it is worth keeping.
  it('offers a favorite toggle for a saved query', () => {
    renderHeader(savedQuery, 7)

    expect(screen.getByRole('button', { name: 'Add to favorites' })).toBeInTheDocument()
  })

  it('offers no favorite toggle before the query is saved', () => {
    renderHeader()

    expect(screen.queryByRole('button', { name: /favorites/i })).not.toBeInTheDocument()
  })

  it('asks before Ask about this leaves a dirty editor', async () => {
    createThread.mockResolvedValue({ id: 't' })
    renderHeader(savedQuery, 7, true)

    await userEvent.click(screen.getByRole('button', { name: 'Ask about Rail boardings in chat' }))

    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument()
    expect(createThread).not.toHaveBeenCalled()
  })
})
