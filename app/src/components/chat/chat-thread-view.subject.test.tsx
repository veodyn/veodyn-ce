import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatThreadController } from '@/hooks/use-chat-thread'
import { emptyThread } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { ChatThreadView } from './chat-thread-view'

const label = vi.hoisted(() => ({ current: undefined as string | undefined }))
vi.mock('@/hooks/use-thread-subject-label', () => ({ useThreadSubjectLabel: () => label.current }))
vi.mock('@/hooks/use-chat-thread', () => ({
  useChatThread: (): ChatThreadController => ({
    state: emptyThread(),
    results: {},
    visualizations: {},
    runErrors: {},
    loading: false,
    loadFailed: false,
    busy: false,
    sendError: null,
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    rerun: vi.fn(),
    reload: vi.fn(),
    promoted: vi.fn(),
    promotedDashboard: vi.fn(),
    promotedEdit: vi.fn(),
    promotedViz: vi.fn(),
    promotedDashboardEdit: vi.fn(),
    promotedContributed: vi.fn(),
    promotedOperation: vi.fn(),
    holdQueryDraftSync: vi.fn(),
    retryQueryDraftSync: vi.fn(),
    dashboardActive: vi.fn(),
  }),
}))

describe('ChatThreadView composer in a thread with a subject', () => {
  it('asks about the subject', () => {
    label.current = 'Ask about Rail boardings'
    renderWithProviders(<ChatThreadView threadId="x" />)
    expect(screen.getByPlaceholderText('Ask about Rail boardings')).toBeInTheDocument()
  })

  it('keeps the default prompt without one', () => {
    label.current = undefined
    renderWithProviders(<ChatThreadView threadId="x" />)
    expect(screen.getByPlaceholderText('Ask a question about your data')).toBeInTheDocument()
  })
})
