import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatToolCardProps } from '@/features/chat-tool-types'
import type { FeatureDescriptor } from '@/features/types'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import type { CallView } from '@/lib/chat/thread-calls'
import type { ThreadState } from '@/lib/chat/thread-model'
import { renderWithProviders } from '@/test/utils'

function KpiCardStub({ call }: ChatToolCardProps) {
  return <p>{call.output?.kind === 'kpi' ? `KPI card: ${call.output.kpi?.name}` : 'KPI card: waiting'}</p>
}

vi.mock('@/features/generated-registry', () => {
  const execute = async () => ({ default: async () => ({ kind: 'kpi' as const, ok: true }) })
  const FEATURES: Record<string, FeatureDescriptor> = {
    kpis: {
      id: 'kpis',
      nav: [],
      routes: [],
      chatTools: [
        { tool: 'show_kpi', execute, card: async () => ({ default: KpiCardStub }), phaseLabel: 'Reading the KPI…' },
        { tool: 'list_kpis', execute, card: () => Promise.reject(new Error('chunk missing')) },
      ],
    },
  }
  return { FEATURES }
})

import { ChatTranscript } from './chat-transcript'

function thread(calls: CallView[], running = false): ThreadState {
  return {
    calls: Object.fromEntries(calls.map((call) => [call.callId, call])),
    helpLinks: {},
    runs: {},
    drafts: {},
    dashboardDrafts: {},
    activeDashboard: null,
    turns: [
      {
        id: 't1',
        seq: 1,
        userText: 'Show me this KPI',
        status: running ? 'running' : 'done',
        items: calls.map((call) => ({ kind: 'call' as const, callId: call.callId })),
        phase: running ? 'waiting_for_browser' : null,
        stopReason: running ? null : 'end_turn',
        errorMessage: null,
        lastEventId: null,
      },
    ],
  }
}

function renderTranscript(state: ThreadState) {
  renderWithProviders(
    <MessageScrollerProvider>
      <MessageScroller>
        <MessageScrollerViewport>
          <MessageScrollerContent>
            <ChatTranscript
              state={state}
              results={{}}
              runErrors={{}}
              selection={null}
              onSelect={vi.fn()}
              onRerun={vi.fn()}
              onRetry={vi.fn()}
              renderDraft={() => null}
            />
          </MessageScrollerContent>
        </MessageScrollerViewport>
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

const DONE: CallView = {
  callId: 'k1',
  tool: 'show_kpi',
  status: 'done',
  target: null,
  output: { kind: 'kpi', ok: true, kpi: { id: 'otp-weekly', name: 'On-time performance' } },
  error: null,
}

describe('a contributed tool in the transcript', () => {
  it('is drawn by the card its feature contributed, not as a saved chart', async () => {
    renderTranscript(thread([DONE]))
    expect(await screen.findByText('KPI card: On-time performance')).toBeInTheDocument()
  })

  it('says what it is waiting for in the feature’s own words', async () => {
    renderTranscript(thread([{ ...DONE, status: 'running', output: null }], true))
    expect(await screen.findByText('KPI card: waiting')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Reading the KPI…')
  })

  it('draws nothing, and breaks nothing, when the card cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const broken: CallView = { ...DONE, callId: 'k2', tool: 'list_kpis', output: { kind: 'kpi_list', ok: true } }
    renderTranscript(thread([broken, DONE]))
    expect(await screen.findByText('KPI card: On-time performance')).toBeInTheDocument()
    expect(screen.getByText('Show me this KPI')).toBeInTheDocument()
    error.mockRestore()
  })
})
