import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatThreadController } from '@/hooks/use-chat-thread'
import { emptyThread, type ThreadState } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { ChatThreadView } from './chat-thread-view'

const controller = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/hooks/use-chat-thread', () => ({ useChatThread: () => controller.current }))
vi.mock('@/hooks/use-data-sources', () => ({
  useDataSources: () => ({ data: [{ id: 4, name: 'Warehouse', type: 'clickhouse' }] }),
}))

const PROPOSAL = {
  name: 'Average speed',
  description: 'Mean speed.',
  sql: 'SELECT avg(speed) FROM t',
  datasetTable: 't',
  vizChoiceId: 'counter',
  vizOptions: {},
}

function thread(): ThreadState {
  return {
    ...emptyThread(),
    runs: {
      c1: {
        callId: 'c1',
        purpose: 'Average speed',
        sql: PROPOSAL.sql,
        vizChoiceId: 'counter',
        status: 'done',
        rowCount: 1,
        durationMs: 20,
        error: null,
      },
    },
    drafts: { d1: { id: 'd1', versions: [{ version: 1, payload: PROPOSAL }], promotions: [] } },
    turns: [
      {
        id: 't1',
        seq: 1,
        userText: 'how fast?',
        status: 'running',
        items: [
          { kind: 'run', callId: 'c1' },
          { kind: 'draft', draftId: 'd1', version: 1 },
        ],
        phase: 'answering',
        stopReason: null,
        errorMessage: null,
        lastEventId: null,
      },
    ],
  }
}

function make(overrides: Partial<ChatThreadController> = {}): ChatThreadController {
  return {
    state: thread(),
    results: {},
    runErrors: {},
    loading: false,
    loadFailed: false,
    busy: true,
    sendError: null,
    send: vi.fn(),
    stop: vi.fn(),
    retry: vi.fn(),
    rerun: vi.fn(),
    promoted: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  controller.current = make()
})

describe('ChatThreadView', () => {
  it('opens a card beside the chat and closes it again', async () => {
    renderWithProviders(<ChatThreadView threadId="x" />)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    const [runOpen, draftOpen] = screen.getAllByRole('button', { name: 'Open beside the chat' })
    await userEvent.click(runOpen)
    expect(screen.getByRole('complementary', { name: 'Details: Average speed' })).toBeInTheDocument()
    expect(screen.getByText('Run the query to see its result here.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    await userEvent.click(draftOpen)
    expect(screen.getByRole('complementary', { name: 'Details: Average speed' })).toBeInTheDocument()
  })

  it('stops a running reply and reruns with the default data source', async () => {
    const current = make()
    controller.current = current
    renderWithProviders(<ChatThreadView threadId="x" />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(current.stop).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Run again to draw the chart' }))
    expect(current.rerun).toHaveBeenCalledWith('c1', 4)
  })

  it('keeps the composer locked while a reply runs and shows send errors', () => {
    controller.current = make({ sendError: 'Nope.' })
    renderWithProviders(<ChatThreadView threadId="x" />)
    expect(screen.getByLabelText('Ask about your data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByText('Nope.')).toBeInTheDocument()
  })

  it('says when the conversation cannot be opened', () => {
    controller.current = make({ loadFailed: true })
    renderWithProviders(<ChatThreadView threadId="x" />)
    expect(screen.getByText('This conversation could not be opened.')).toBeInTheDocument()
  })
})
