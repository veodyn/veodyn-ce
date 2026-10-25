import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatDraftCardProps } from '@/features/chat-draft-types'
import type { FeatureDescriptor } from '@/features/types'
import type { ChatPromotion } from '@/lib/chat/wire'
import { FakeEventSource } from '@/test/fake-event-source'
import { renderWithProviders } from '@/test/utils'

const THREAD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STAMP = '2026-10-25T00:00:00Z'
const PAYLOAD = {
  name: 'Average speed',
  description: 'Mean.',
  sql: 'SELECT avg(speed) FROM t',
  dataSourceId: 5,
  datasetTable: 't',
  vizChoiceId: 'table',
  vizOptions: {},
}
const PENDING: ChatPromotion = {
  id: 'p1',
  targetType: 'query',
  targetId: null,
  promotedVersion: 1,
  targetVersionAtPromote: null,
  status: 'pending',
  receipts: [],
  createdAt: STAMP,
  updatedAt: STAMP,
}
const PATCH = { status: 'done' as const, targetId: '44', receipts: [{ step: 0, outcome: 'done' as const, targetId: '44' }] }

const mocks = vi.hoisted(() => ({
  getThread: vi.fn(),
  recordPromotion: vi.fn(),
  patchPromotion: vi.fn(),
  write: vi.fn(),
  storedGet: vi.fn(),
}))

vi.mock('@/services/ai/chat-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/ai/chat-client')>()),
  getThread: mocks.getThread,
  recordPromotion: mocks.recordPromotion,
  patchPromotion: mocks.patchPromotion,
}))
vi.mock('@/components/chat/proposal-kit/use-write-proposed-query', () => ({
  useWriteProposedQuery: () => ({ write: mocks.write, isPending: false }),
}))
vi.mock('@/services/redash/queries', () => ({ get: mocks.storedGet }))
vi.mock('@/hooks/use-thread-subject-label', () => ({ useThreadSubjectLabel: () => undefined }))

function KpiStub({ queryDraftSync, holdQueryDraftSync, retryQueryDraftSync }: ChatDraftCardProps) {
  const held = queryDraftSync.q1
  return (
    <div>
      <p>{held ? `KPI reads saved query ${held.promotion.targetId}` : 'KPI sees no held query'}</p>
      <button type="button" onClick={() => holdQueryDraftSync('q1', { promotion: { ...PENDING, ...PATCH }, patch: PATCH })}>
        KPI saved the query
      </button>
      <button type="button" onClick={() => void retryQueryDraftSync('q1')}>
        KPI retry
      </button>
    </div>
  )
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatDrafts: [{ kind: 'kpi', parse: (payload) => payload, card: async () => ({ default: KpiStub }) }],
    },
  }
  return { FEATURES }
})

import { ChatThreadView } from './chat-thread-view'

function block(callId: string, tool: string, draftId: string) {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id: callId, name: tool, input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content: `{"draftId":"${draftId}","version":1}` }] },
  ]
}

function detail() {
  return {
    thread: { id: THREAD, title: '', pinned: false, createdAt: STAMP, updatedAt: STAMP, lastTurnAt: STAMP, origin: 'chat' },
    turns: [
      {
        id: TURN,
        seq: 1,
        status: 'done',
        userText: 'go',
        stopReason: 'end_turn',
        errorId: null,
        createdAt: STAMP,
        finishedAt: STAMP,
        lastEventId: null,
        blocks: [...block('c1', 'propose_query', 'q1'), ...block('c2', 'propose_kpi', 'k1')],
      },
    ],
    drafts: [
      { id: 'q1', kind: 'query', versions: [{ version: 1, payload: PAYLOAD }], promotions: [] },
      { id: 'k1', kind: 'kpi', versions: [{ version: 1, payload: { queryDraftId: 'q1' } }], promotions: [] },
    ],
  }
}

beforeEach(() => {
  FakeEventSource.reset()
  vi.stubGlobal('EventSource', FakeEventSource)
  mocks.getThread.mockResolvedValue(detail())
  mocks.recordPromotion.mockResolvedValue(PENDING)
  mocks.patchPromotion.mockImplementation(async (_draft: string, id: string, patch: object) => ({ ...PENDING, ...patch, id }))
  mocks.write.mockResolvedValue({ queryId: 44, visualizationId: null })
  mocks.storedGet.mockResolvedValue({ id: 44, updated_at: STAMP })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mounted() {
  renderWithProviders(<ChatThreadView threadId={THREAD} />)
  return screen.findByRole('button', { name: 'KPI saved the query' })
}

describe('one held query record per query draft, shared by every card in the thread', () => {
  it('a record another card holds hides Save on the query card', async () => {
    await userEvent.click(await mounted())
    expect(await screen.findByText('Saved, but the record of it did not save.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as query' })).not.toBeInTheDocument()
    expect(screen.getByText('KPI reads saved query 44')).toBeInTheDocument()
  })

  it('the query card holding its own unsynced save shows it to the other card', async () => {
    await mounted()
    mocks.patchPromotion.mockRejectedValueOnce(new Error('sidecar down'))
    await userEvent.click(screen.getByRole('button', { name: 'Save as query' }))
    expect(await screen.findByText('KPI reads saved query 44')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save as query' })).not.toBeInTheDocument()
    expect(mocks.write).toHaveBeenCalledTimes(1)
  })

  it('a retry from the other card clears the hold on both cards', async () => {
    await userEvent.click(await mounted())
    await userEvent.click(screen.getByRole('button', { name: 'KPI retry' }))
    expect(await screen.findByRole('link', { name: 'Saved as query 44 · v1' })).toBeInTheDocument()
    expect(screen.getByText('KPI sees no held query')).toBeInTheDocument()
    expect(mocks.patchPromotion).toHaveBeenCalledTimes(1)
  })

  it('a retry from the query card clears the hold on both cards', async () => {
    await userEvent.click(await mounted())
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('KPI sees no held query')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Saved as query 44 · v1' })).toBeInTheDocument()
    expect(mocks.write).not.toHaveBeenCalled()
  })
})
