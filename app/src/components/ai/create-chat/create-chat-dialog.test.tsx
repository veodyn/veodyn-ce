// The chat shell, driven with a COMMUNITY proposal kind throughout.
//
// The three cases below that need a pending proposal used to use a KPI one,
// which is why this file was on the old CE-build ratchet. Nothing in them is about
// a KPI: they pin the discard confirmation, the routing after a create, and the
// scroller row a card occupies, all of which the query card exercises exactly as
// well. What genuinely needed the KPI card is now
// src/components/kpi/create-chat-kpi.test.tsx and
// src/components/kpi/create-chat-revision.test.tsx.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentUser, mockQueries } from '@/lib/mock-data'
import { useAuthStore, type CurrentUser } from '@/stores/auth-store'
import { useMockDataStore } from '@/stores/mock-data-store'
import { server } from '@/test/msw/server'
import { renderWithProviders, resetStores } from '@/test/utils'
import type { ConverseRequest, QueryProposal } from '@/types/ai-create'
import { CreateChatDialog } from './create-chat-dialog'
import { useCreateChat } from './use-create-chat'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

const QUERY_PROPOSAL: QueryProposal = {
  kind: 'query',
  name: 'Rail punctuality',
  description: 'Share of rail trips arriving on schedule',
  sql: 'select 1',
  datasetTable: 'rail_trips',
  vizChoiceId: 'table',
  vizOptions: {},
}

interface TurnSpec {
  reply?: string
  suggestedAnswers?: string[]
  proposal?: QueryProposal
  status?: number
  /** Held open until the returned release is called, to overlap two turns. */
  hold?: Promise<void>
}

/** Script the relay turn by turn; the last entry repeats. Returns the log. */
function stubConverse(script: TurnSpec[]): ConverseRequest[] {
  const sent: ConverseRequest[] = []
  server.use(
    http.post('/api/ai/converse', async ({ request }) => {
      const body = (await request.json()) as ConverseRequest
      sent.push(body)
      const spec = script[Math.min(sent.length - 1, script.length - 1)]
      if (spec.hold != null) await spec.hold
      if (spec.status != null) {
        return HttpResponse.json({ error: { id: 'E_AI_001' } }, { status: spec.status })
      }
      return HttpResponse.json({
        reply: spec.reply ?? 'ok',
        suggestedAnswers: spec.suggestedAnswers ?? [],
        ready: spec.proposal != null,
        proposal: spec.proposal ?? null,
        // The wire always carries the key: omitting it sends undefined up next turn.
        focusTable: null,
      })
    })
  )
  return sent
}

const AUTHOR: CurrentUser = {
  ...currentUser,
  permissions: [],
  isAdmin: false,
  hasPermission: () => true,
  canEdit: () => true,
  canCreate: () => true,
}

beforeEach(() => {
  push.mockClear()
  resetStores()
  useAuthStore.setState({ currentUser: AUTHOR })
  useMockDataStore.setState({ queries: mockQueries.map((query) => ({ ...query })) })
})

function renderDialog(kind: ConverseRequest['kind'] = 'query') {
  const onClose = vi.fn()
  renderWithProviders(<CreateChatDialog kind={kind} onClose={onClose} />)
  return { onClose, user: userEvent.setup() }
}

async function say(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByRole('textbox', { name: 'Message the AI' }), text)
  await user.click(screen.getByRole('button', { name: 'Send' }))
}

describe('CreateChatDialog', () => {
  it('posts the transcript and offers the reply chips as the next message', async () => {
    const sent = stubConverse([
      { reply: 'Which stations?', suggestedAnswers: ['All of them'] },
      { reply: 'Understood.' },
    ])
    const { user } = renderDialog()

    await say(user, 'trips by station')

    expect(await screen.findByText('Which stations?')).toBeVisible()
    expect(screen.getByText('trips by station')).toBeVisible()

    // A chip is a label to display and the exact message it sends. Clicking it
    // is a user turn like any other, so the whole transcript goes back up.
    await user.click(screen.getByRole('button', { name: 'All of them' }))

    await screen.findByText('Understood.')
    expect(sent[1]).toEqual({
      kind: 'query',
      messages: [
        { role: 'user', content: 'trips by station' },
        { role: 'assistant', content: 'Which stations?' },
        { role: 'user', content: 'All of them' },
      ],
      focusTable: null,
    })
  })

  it('stops sending at twelve user turns and offers the manual path', async () => {
    const sent = stubConverse([{ reply: 'Go on.', suggestedAnswers: ['Yes'] }])
    const { user } = renderDialog()

    // Twelve is written out rather than derived from MAX_USER_TURNS: read from
    // the constant, this test would pass at any cap, which is the one thing it
    // exists to catch.
    await say(user, 'a')
    for (let turn = 2; turn <= 12; turn += 1) {
      await user.click(await screen.findByRole('button', { name: 'Yes' }))
      await waitFor(() => expect(sent).toHaveLength(turn))
    }

    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Message the AI' })).toBeDisabled()
    )
    expect(screen.getByText(/used all 12 turns/)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Write the query yourself' })).toHaveAttribute(
      'href',
      '/queries/new'
    )
    // The chips are a send path too, so the cap has to close them as well.
    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    expect(sent).toHaveLength(12)
  })

  it('keeps the transcript when a turn fails and retries that same turn', async () => {
    const sent = stubConverse([{ status: 503 }, { reply: 'Which stations?' }])
    const { user } = renderDialog()

    await say(user, 'trips by station')

    expect(await screen.findByText(/could not answer that turn/)).toBeVisible()
    // Never a dead end: what was typed is still there, and so is the way out.
    expect(screen.getByText('trips by station')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Write the query yourself' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Which stations?')).toBeVisible()
    // The retry re-sends the failed turn instead of asking for it again, so the
    // message is not duplicated and the failure text never reaches the model.
    expect(screen.getAllByText('trips by station')).toHaveLength(1)
    expect(sent[1]).toEqual({
      kind: 'query',
      messages: [{ role: 'user', content: 'trips by station' }],
      focusTable: null,
    })
  })

  it('confirms before discarding a pending proposal, and creates nothing', async () => {
    stubConverse([{ reply: 'Here it is.', proposal: QUERY_PROPOSAL }])
    const { onClose, user } = renderDialog('query')

    await say(user, 'track punctuality')
    await screen.findByRole('button', { name: 'Create query' })

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent('Discard this proposal?')

    await user.click(screen.getByRole('button', { name: 'Keep chatting' }))
    expect(screen.getByRole('button', { name: 'Create query' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(useMockDataStore.getState().queries).toHaveLength(mockQueries.length)
  })

  it('closes without confirming while there is nothing to lose', async () => {
    stubConverse([{ reply: 'Which stations?' }])
    const { onClose, user } = renderDialog()

    await say(user, 'trips by station')
    await screen.findByText('Which stations?')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Discard this proposal?')).toBeNull()
  })

  it('closes and routes where the create says to go', async () => {
    stubConverse([{ reply: 'Here it is.', proposal: QUERY_PROPOSAL }])
    const { onClose, user } = renderDialog('query')

    await say(user, 'track punctuality')
    await user.click(await screen.findByRole('button', { name: 'Create query' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    const stored = useMockDataStore
      .getState()
      .queries.find((query) => query.name === QUERY_PROPOSAL.name)
    expect(stored).toBeDefined()
    expect(push).toHaveBeenCalledWith(`/queries/${stored?.id}`)
  })

  // The card is the last thing in the scroller, and it has to be its own row
  // rather than loose content: a row is what the scroller can address, measure
  // and bring into view when the reply above it is taller than the panel.
  //
  // No row may be a scroll anchor. Anchoring lifts a turn to the top of the
  // viewport, and the primitive does that by appending a spacer sized from the
  // viewport's own height. This panel's height is its content's (`fill="max"`),
  // so the spacer grows the content, the content grows the panel, and the taller
  // panel asks for a taller spacer: measured in a browser, one anchored row took
  // the dialog from 309px to the 1329px cap with 610px of it empty spacer and
  // the user's own message clipped off the top. jsdom runs no layout so it
  // cannot see the pixels, but it can see the attribute that causes them.
  it('gives the proposal its own row, and anchors none of them', async () => {
    stubConverse([{ reply: 'Here it is.', proposal: QUERY_PROPOSAL }])
    const { user } = renderDialog('query')

    await say(user, 'track punctuality')
    const create = await screen.findByRole('button', { name: 'Create query' })

    const row = create.closest('[data-slot="message-scroller-item"]')
    expect(row).not.toBeNull()
    // Its own row, not the reply's: the rows are siblings, so containment is
    // the difference.
    expect(row?.textContent).not.toContain('Here it is.')

    const rows = Array.from(document.querySelectorAll('[data-slot="message-scroller-item"]'))
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.map((el) => el.getAttribute('data-scroll-anchor'))).not.toContain('true')
  })
})

// The composer locks for the whole of a turn, so two overlapping sends are not
// reachable through the dialog today. The guard is proven here against the hook
// directly, because the day the composer stops locking is the day a stale reply
// would start overwriting a newer one, and that must fail loudly, not silently.
function SupersedeHarness() {
  const chat = useCreateChat('query')
  return (
    <div>
      <button type="button" onClick={() => chat.send('first')}>
        send first
      </button>
      <button type="button" onClick={() => chat.send('second')}>
        send second
      </button>
      <ul>
        {chat.turns.map((turn) => (
          <li key={turn.seq}>{`${turn.role}: ${turn.content}`}</li>
        ))}
      </ul>
    </div>
  )
}

describe('useCreateChat', () => {
  it('never lets a superseded response land in the transcript', async () => {
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    stubConverse([{ reply: 'STALE', hold }, { reply: 'FRESH' }])
    const user = userEvent.setup()
    renderWithProviders(<SupersedeHarness />)

    await user.click(screen.getByRole('button', { name: 'send first' }))
    await user.click(screen.getByRole('button', { name: 'send second' }))
    expect(await screen.findByText('assistant: FRESH')).toBeVisible()

    release()
    // Both halves of the guard: the superseded reply must not appear, and the
    // abort that superseded it must not surface as a failed turn either.
    await waitFor(() => expect(screen.queryByText(/STALE/)).toBeNull())
    expect(screen.queryByText(/could not answer that turn/)).toBeNull()
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'user: first',
      'user: second',
      'assistant: FRESH',
    ])
  })
})
