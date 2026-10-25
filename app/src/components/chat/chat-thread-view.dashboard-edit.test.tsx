import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatThreadController } from '@/hooks/use-chat-thread'
import { emptyThread } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { ChatThreadView } from './chat-thread-view'

const controller = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/hooks/use-chat-thread', () => ({ useChatThread: () => controller.current }))
vi.mock('@/hooks/use-thread-subject-label', () => ({ useThreadSubjectLabel: () => undefined }))
vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: vi.fn(), isPending: false }),
}))

const PAYLOAD = {
  dashboardId: 4,
  snapshot: { name: 'Ops', tags: [], version: 1, updatedAt: 'u', widgets: [] },
  operations: [{ op: 'addText' as const, text: 'Footer', position: { col: 0, row: 0, sizeX: 6, sizeY: 4 } }],
}

describe('ChatThreadView with a dashboard edit', () => {
  it('draws the edit card with its Apply button and nothing for the update_dashboard call itself', () => {
    const state = {
      ...emptyThread(),
      dashboardEditDrafts: { d1: { id: 'd1', versions: [{ version: 1, payload: PAYLOAD }], promotions: [] } },
      calls: {
        u1: {
          callId: 'u1',
          tool: 'update_dashboard' as const,
          status: 'done' as const,
          target: null,
          output: null,
          error: null,
        },
      },
      turns: [
        {
          id: 't1',
          seq: 1,
          userText: 'add a footer',
          status: 'done' as const,
          items: [
            { kind: 'call' as const, callId: 'u1' },
            { kind: 'draft' as const, draftId: 'd1', version: 1 },
          ],
          phase: null,
          stopReason: 'end_turn',
          errorMessage: null,
          lastEventId: null,
        },
      ],
    }
    controller.current = {
      state,
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
    } satisfies ChatThreadController
    renderWithProviders(<ChatThreadView threadId="x" />)
    expect(screen.getByRole('link', { name: 'Ops' })).toHaveAttribute('href', '/dashboards/4')
    expect(screen.getByText('Add text: Footer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Open beside the chat' })).toHaveLength(0)
  })
})
