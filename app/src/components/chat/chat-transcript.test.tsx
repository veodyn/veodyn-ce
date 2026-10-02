import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import type { RunView, ThreadState } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'
import { ChatTranscript, LIBRARY_PHASE_LABELS, PHASE_LABELS } from './chat-transcript'
import { runStatusLabel } from './run-card'

const RUN: RunView = {
  callId: 'c1',
  dataSourceId: 5,
  purpose: 'Average speed',
  sql: 'SELECT 1 FROM t',
  vizChoiceId: 'counter',
  status: 'done',
  rowCount: 1200,
  durationMs: 4100,
  error: null,
}

function state(overrides: Partial<ThreadState['turns'][number]> = {}, run: RunView = RUN): ThreadState {
  return {
    calls: {},
    helpLinks: {},
    runs: { c1: run },
    drafts: {},
    dashboardDrafts: {},
    activeDashboard: null,
    turns: [
      {
        id: 't1',
        seq: 1,
        userText: 'how fast?',
        status: 'done',
        items: [
          { kind: 'text', text: 'Here is **the** answer.' },
          { kind: 'run', callId: 'c1' },
          { kind: 'draft', draftId: 'd1', version: 1 },
        ],
        phase: null,
        stopReason: 'end_turn',
        errorMessage: null,
        lastEventId: null,
        ...overrides,
      },
    ],
  }
}

function renderTranscript(thread: ThreadState, overrides: Record<string, unknown> = {}) {
  const props = {
    state: thread,
    results: {},
    runErrors: {},
    selection: null,
    onSelect: vi.fn(),
    onRerun: vi.fn(),
    onRetry: vi.fn(),
    renderDraft: (draftId: string, version: number) => <p>{`draft ${draftId} v${version}`}</p>,
    ...overrides,
  }
  renderWithProviders(
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            <ChatTranscript {...props} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  )
  return props
}

describe('ChatTranscript', () => {
  it('shows the question, the answer, the run and the draft', async () => {
    const props = renderTranscript(state())
    expect(screen.getByText('how fast?')).toBeInTheDocument()
    expect(screen.getByText('the')).toBeInTheDocument()
    expect(screen.getByText('Average speed')).toBeInTheDocument()
    expect(screen.getByText('1,200 rows · 4.1 s')).toBeInTheDocument()
    expect(screen.getByText('draft d1 v1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run again to draw the chart' }))
    expect(props.onRerun).toHaveBeenCalledWith('c1')
    await userEvent.click(screen.getByRole('button', { name: 'Open beside the chat' }))
    expect(props.onSelect).toHaveBeenCalledWith({ kind: 'run', id: 'c1' })
  })

  it('shows the phase while a turn runs', () => {
    renderTranscript(state({ status: 'running', phase: 'waiting_for_browser', items: [] }))
    expect(screen.getByRole('status')).toHaveTextContent(PHASE_LABELS.waiting_for_browser)
  })

  it('offers retry on the last failed turn', async () => {
    const props = renderTranscript(state({ status: 'failed', errorMessage: 'It broke.', items: [] }))
    expect(screen.getByRole('alert')).toHaveTextContent('It broke.')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(props.onRetry).toHaveBeenCalled()
  })

  it('offers no rerun for a run whose data source is unknown', () => {
    renderTranscript(state({}, { ...RUN, dataSourceId: 0 }))
    expect(screen.queryByRole('button', { name: 'Run again to draw the chart' })).not.toBeInTheDocument()
  })
})

describe('help links in a turn', () => {
  const link = (callId: string, pageTitle: string, sectionTitle: string | null) => ({
    callId,
    page: 'features/queries',
    pageTitle,
    anchor: sectionTitle ? 'parameters' : null,
    sectionTitle,
    reason: `Why ${callId}`,
  })

  function threadWithLinks(overrides: Record<string, unknown> = {}) {
    const thread = state({
      status: 'running',
      phase: 'answering',
      stopReason: null,
      items: [
        { kind: 'text', text: 'Here you go.' },
        { kind: 'help', callId: 'h1' },
        { kind: 'help', callId: 'h2' },
      ],
      ...overrides,
    })
    thread.helpLinks = { h1: link('h1', 'Queries', 'Parameters'), h2: link('h2', 'Schedules', null) }
    return thread
  }

  it('draws consecutive links as one card and keeps the text before them', () => {
    renderTranscript(threadWithLinks())
    expect(screen.getByText('Here you go.')).toBeInTheDocument()
    expect(screen.getAllByText('Documentation')).toHaveLength(1)
    expect(screen.getByText('Queries › Parameters')).toBeInTheDocument()
    expect(screen.getByText('Schedules')).toBeInTheDocument()
  })

  it('keeps the thinking label, because linking takes no browser round trip', () => {
    renderTranscript(threadWithLinks({ phase: 'validating' }))
    expect(screen.getByRole('status')).toHaveTextContent(PHASE_LABELS.answering)
  })

  it('separates links that are not next to each other', () => {
    renderTranscript(
      threadWithLinks({
        items: [
          { kind: 'help', callId: 'h1' },
          { kind: 'text', text: 'And also:' },
          { kind: 'help', callId: 'h2' },
        ],
      })
    )
    expect(screen.getAllByText('Documentation')).toHaveLength(2)
  })
})

describe('runStatusLabel', () => {
  it('names each state', () => {
    expect(runStatusLabel({ ...RUN, status: 'running' })).toBe('Running in your browser…')
    expect(runStatusLabel({ ...RUN, status: 'failed' })).toBe('The query failed')
    expect(runStatusLabel({ ...RUN, rowCount: 1, durationMs: null })).toBe('1 row')
    expect(runStatusLabel({ ...RUN, rowCount: null, durationMs: null })).toBe('Done')
  })

  it('renders library and dashboard calls, and says when it is looking in the library', () => {
    const thread = state({
      status: 'running',
      phase: 'waiting_for_browser',
      stopReason: null,
      items: [
        { kind: 'call', callId: 'd1' },
        { kind: 'call', callId: 's1' },
      ],
    })
    thread.calls = {
      d1: {
        callId: 'd1',
        tool: 'open_dashboard',
        status: 'done',
        target: null,
        output: { kind: 'dashboard', ok: true, dashboard: { id: 4, name: 'Bikeshare overview' }, widgets: [] },
        error: null,
      },
      s1: { callId: 's1', tool: 'search_library', status: 'running', target: null, output: null, error: null },
    }
    renderTranscript(thread)
    expect(screen.getByRole('link', { name: 'Bikeshare overview' })).toBeInTheDocument()
    expect(screen.getByText('Searching the library…')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(LIBRARY_PHASE_LABELS.waiting_for_browser)
    expect(PHASE_LABELS.waiting_for_browser).not.toBe(LIBRARY_PHASE_LABELS.waiting_for_browser)
  })
})
