import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ChatDraftCardProps } from '@/features/chat-draft-types'
import type { FeatureDescriptor } from '@/features/types'
import type { ChatThreadController } from '@/hooks/use-chat-thread'
import { emptyThread, type ContributedDraftView, type ThreadState } from '@/lib/chat/thread-model'
import type { ChatPromotion } from '@/lib/chat/wire'
import { renderWithProviders } from '@/test/utils'

function KpiCardStub({ draftId, version, payload, onPromoted }: ChatDraftCardProps) {
  const name = (payload as { name: string }).name
  const promotion = { id: 'p', targetType: 'kpi' } as ChatPromotion
  return (
    <button type="button" onClick={() => onPromoted(promotion)}>
      {`KPI card ${draftId} v${version}: ${name}`}
    </button>
  )
}

function ContextCardStub({ threadId, queryDrafts, onQueryDraftPromoted }: ChatDraftCardProps) {
  const names = Object.values(queryDrafts).map((draft) => draft.versions.at(-1)?.payload.name)
  const saved = { id: 'qp', targetType: 'query' } as ChatPromotion
  return (
    <button type="button" onClick={() => onQueryDraftPromoted('q1', saved)}>
      {`thread ${threadId} reads ${names.join(', ')}`}
    </button>
  )
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatDrafts: [
        { kind: 'kpi', parse: (payload) => payload, card: async () => ({ default: KpiCardStub }) },
        { kind: 'report', parse: (payload) => payload, card: () => Promise.reject(new Error('chunk missing')) },
        { kind: 'kpi_context', parse: (payload) => payload, card: async () => ({ default: ContextCardStub }) },
      ],
    },
  }
  return { FEATURES }
})

const controller = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/hooks/use-chat-thread', () => ({ useChatThread: () => controller.current }))
vi.mock('@/hooks/use-thread-subject-label', () => ({ useThreadSubjectLabel: () => undefined }))

import { ChatThreadView } from './chat-thread-view'

function mount(
  drafts: Record<string, ContributedDraftView>,
  promotedContributed = vi.fn(),
  queryDrafts: ThreadState['drafts'] = {}
) {
  const state = {
    ...emptyThread(),
    drafts: queryDrafts,
    contributedDrafts: drafts,
    turns: [
      {
        id: 't1',
        seq: 1,
        userText: 'go',
        status: 'done' as const,
        items: Object.values(drafts).map((draft) => ({
          kind: 'draft' as const,
          draftId: draft.id,
          version: draft.versions.at(-1)?.version ?? 1,
        })),
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
    promotedContributed,
    promotedOperation: vi.fn(),
    holdQueryDraftSync: vi.fn(),
    retryQueryDraftSync: vi.fn(),
    dashboardActive: vi.fn(),
  } satisfies ChatThreadController
  return renderWithProviders(<ChatThreadView threadId="x" />)
}

describe('ChatThreadView with drafts it does not draw itself', () => {
  it('draws the card a feature contributed, with the payload and a way to record a promotion', async () => {
    const promotedContributed = vi.fn()
    mount(
      { k1: { id: 'k1', kind: 'kpi', versions: [{ version: 2, payload: { name: 'On-time' } }], promotions: [] } },
      promotedContributed
    )
    const card = await screen.findByRole('button', { name: 'KPI card k1 v2: On-time' })
    await userEvent.click(card)
    expect(promotedContributed).toHaveBeenCalledWith('k1', expect.objectContaining({ id: 'p' }))
  })

  it('hands a contributed card the thread id and the query drafts the thread holds right now', async () => {
    const query = {
      id: 'q1',
      versions: [{ version: 1, payload: { name: 'Trips', sql: 'SELECT 1', dataSourceId: 3 } }],
      promotions: [],
    } as unknown as ThreadState['drafts'][string]
    mount(
      { c1: { id: 'c1', kind: 'kpi_context', versions: [{ version: 1, payload: {} }], promotions: [] } },
      vi.fn(),
      { q1: query }
    )
    const card = await screen.findByRole('button', { name: 'thread x reads Trips' })
    await userEvent.click(card)
    const { promoted } = controller.current as ChatThreadController
    expect(promoted).toHaveBeenCalledWith('q1', expect.objectContaining({ id: 'qp' }))
  })

  it('says this build cannot show a kind no feature contributes', () => {
    mount({ m1: { id: 'm1', kind: 'message', versions: [{ version: 1, payload: { title: 't' } }], promotions: [] } })
    expect(screen.getByText('This build cannot show a message proposal.')).toBeInTheDocument()
  })

  it('says the same when the contributing feature refused the payload', () => {
    mount({ k2: { id: 'k2', kind: 'kpi', versions: [], promotions: [] } })
    expect(screen.getByText('This build cannot show a kpi proposal.')).toBeInTheDocument()
  })

  it('draws nothing, and does not crash, when a contributed card fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      mount({ r1: { id: 'r1', kind: 'report', versions: [{ version: 1, payload: { goal: 'g' } }], promotions: [] } })
      await vi.waitFor(() => expect(error).toHaveBeenCalled())
      expect(screen.queryByText(/cannot show/)).not.toBeInTheDocument()
    } finally {
      error.mockRestore()
    }
  })

  it('draws the community snippet card for a snippet draft', async () => {
    mount({
      s1: {
        id: 's1',
        kind: 'snippet',
        versions: [{ version: 1, payload: { trigger: 'dt', snippet: 'select 1', description: '' } }],
        promotions: [],
      },
    })
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByText('select 1')).toBeInTheDocument()
  })
})
