import { describe, expect, it } from 'vitest'
import type { FeatureDescriptor, ProposalManualPath } from '@/features/types'
import { AppError, ErrorIds } from '@/lib/errorIds'
import { MAX_MESSAGE_CHARS, MAX_TRANSCRIPT_MESSAGES } from '@/types/ai-create'
import type { CreateKind } from '@/types/ai-create'
import {
  appendTurn,
  assistantTurn,
  canSend,
  composerPlaceholder,
  composerState,
  countUserTurns,
  dialogTitle,
  dropTrailingFailures,
  failedTurn,
  isAtTurnCap,
  manualPath,
  openingPrompt,
  toConverseMessages,
  turnErrorText,
  userTurn,
  type ChatTurn,
  type NewChatTurn,
} from './create-chat-model'

const KINDS: CreateKind[] = ['query', 'dashboard', 'kpi', 'report', 'snippet']

/**
 * A descriptor that claims one proposal kind and offers a by-hand route for it.
 *
 * The explicit input the manualPath cases run on, so what they assert is the
 * fallback itself and not which packages happen to be installed. `parse` and
 * `render` are never reached: manualPath only reads `manual`.
 */
function contributor(id: string, kind: string, manual: ProposalManualPath): FeatureDescriptor {
  return {
    id,
    nav: [],
    routes: [],
    proposals: [
      { kind, parse: () => null, render: async () => ({ default: () => null }), manual },
    ],
  }
}

/** Append with the caller-owned counter the hook supplies at runtime. */
function build(...turns: NewChatTurn[]): ChatTurn[] {
  return turns.reduce<ChatTurn[]>(
    (built, turn, index) => appendTurn(built, turn, index + 1),
    []
  )
}

/** A finished conversation: `count` user turns, each with its reply. */
function conversation(count: number): ChatTurn[] {
  const turns: NewChatTurn[] = []
  for (let i = 0; i < count; i += 1) {
    turns.push(userTurn(`ask ${i}`), assistantTurn(`reply ${i}`, []))
  }
  return build(...turns)
}

describe('transcript assembly', () => {
  it('takes its key from the caller so a dropped bubble cannot hand one back', () => {
    const withFailure = build(userTurn('trips by station'), failedTurn(new Error('boom')))
    // The retry drops the failure at seq 2; the reply that replaces it is
    // appended at 3, the next value of the hook's counter, not at 2 again.
    const retried = appendTurn(
      dropTrailingFailures(withFailure),
      assistantTurn('Which?', []),
      3
    )

    expect(withFailure.map((turn) => turn.seq)).toEqual([1, 2])
    expect(retried.map((turn) => turn.seq)).toEqual([1, 3])
  })

  it('drops only the trailing run of failures', () => {
    const failedAgain = build(
      userTurn('a'),
      failedTurn(new Error('early')),
      assistantTurn('recovered', []),
      userTurn('b'),
      failedTurn(new Error('late'))
    )

    // The early failure is history the user already saw recovered from; only
    // the run at the end is the turn a retry re-sends.
    expect(dropTrailingFailures(failedAgain).map((turn) => turn.content)).toEqual([
      'a',
      turnErrorText(new Error('early')),
      'recovered',
      'b',
    ])
  })

  it('leaves a transcript with no trailing failure identical', () => {
    const turns = conversation(2)
    expect(dropTrailingFailures(turns)).toBe(turns)
  })

  it('sends the model its own words, never the failure text this client wrote', () => {
    const turns = build(
      userTurn('trips by station'),
      failedTurn(new Error('down')),
      assistantTurn('Which stations?', ['All of them'])
    )

    expect(toConverseMessages(turns)).toEqual([
      { role: 'user', content: 'trips by station' },
      { role: 'assistant', content: 'Which stations?' },
    ])
  })
})

describe('the turn cap', () => {
  // The counts here are literals on purpose. Written as MAX_USER_TURNS - 1 and
  // MAX_USER_TURNS this test would pass at any cap, which is the one thing it
  // exists to catch.
  it('stops the conversation at twelve user turns and not before', () => {
    expect(countUserTurns(conversation(11))).toBe(11)
    expect(isAtTurnCap(conversation(11))).toBe(false)
    expect(isAtTurnCap(conversation(12))).toBe(true)
  })

  it('keeps a capped conversation inside the wire limit', () => {
    // 12 user turns and a reply each is 24 messages, one under the cap the
    // relay enforces. Raising the turn cap without raising this one produces
    // requests the relay rejects, so the arithmetic is asserted rather than
    // assumed.
    const full = conversation(12)
    expect(isAtTurnCap(full)).toBe(true)
    expect(toConverseMessages(full).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_MESSAGES)
  })
})

describe('composerState', () => {
  const idle = { turns: conversation(1), sending: false, creating: false }

  it('is open when nothing is in flight', () => {
    expect(composerState(idle)).toEqual({ disabled: false, notice: null, atCap: false })
  })

  it('locks silently while a turn is in flight and out loud while a create is', () => {
    expect(composerState({ ...idle, sending: true })).toMatchObject({
      disabled: true,
      notice: null,
    })
    const creating = composerState({ ...idle, creating: true })
    expect(creating.disabled).toBe(true)
    expect(creating.notice).not.toBeNull()
  })

  it('offers an explanation, not silence, at the cap', () => {
    const capped = composerState({ turns: conversation(12), sending: false, creating: false })
    expect(capped).toMatchObject({ disabled: true, atCap: true })
    expect(capped.notice).toContain('12')
  })

  it('reports the cap even while a turn is still in flight', () => {
    // Ordering matters: the last reply lands while the transcript is already
    // full, and the user must be told why the composer stayed shut.
    expect(
      composerState({ turns: conversation(12), sending: true, creating: false }).atCap
    ).toBe(true)
  })
})

describe('canSend', () => {
  const open = composerState({ turns: [], sending: false, creating: false })

  it('needs something other than whitespace', () => {
    expect(canSend('   ', open)).toBe(false)
    expect(canSend('a', open)).toBe(true)
  })

  it('refuses a message past the per-message cap', () => {
    expect(canSend('x'.repeat(MAX_MESSAGE_CHARS), open)).toBe(true)
    expect(canSend('x'.repeat(MAX_MESSAGE_CHARS + 1), open)).toBe(false)
  })

  it('refuses whenever the composer is locked', () => {
    const locked = composerState({ turns: [], sending: true, creating: false })
    expect(canSend('ready to send', locked)).toBe(false)
  })
})

describe('error copy', () => {
  it('carries the registry id so a support request can grep for it', () => {
    const text = turnErrorText(
      new AppError(ErrorIds.AI_REQUEST_FAILED, 'AI request failed', { status: 503 })
    )
    expect(text).toContain('AI request failed')
    expect(text).toContain(ErrorIds.AI_REQUEST_FAILED)
  })

  it('says something useful for a thrown non-Error', () => {
    expect(turnErrorText('nope')).toBe('The AI could not answer that turn.')
  })

  it('marks the bubble as a failure so the wire projection can drop it', () => {
    expect(failedTurn(new Error('x'))).toMatchObject({ role: 'assistant', failed: true })
  })
})

describe('per-kind copy', () => {
  it.each(KINDS)('gives %s its own title, opening and placeholder', (kind) => {
    expect(dialogTitle(kind)).toContain('Create')
    expect(openingPrompt(kind).length).toBeGreaterThan(0)
    expect(composerPlaceholder(kind).length).toBeGreaterThan(0)
  })

  it('never gives two kinds the same title', () => {
    const titles = KINDS.map(dialogTitle)
    expect(new Set(titles).size).toBe(KINDS.length)
  })

  // Two of these five no longer come from this module. `kpi` and `report` are
  // resolved through FeatureDescriptor.proposals, so what is asserted here is
  // the MECHANISM: the three community kinds come off the table, and a kind a
  // feature claims comes off that feature's own `manual` field. Driven by an
  // explicit registry rather than whatever this build installs, so the case
  // says the same thing in every build. Which routes the real KPI and report
  // packages name is their fact, and a build that installs them asserts it in
  // its own suite.
  it('points each kind at the route that creates it by hand', () => {
    const registry = {
      kpis: contributor('kpis', 'kpi', { href: '/kpis/new', label: 'Define the KPI yourself' }),
      reports: contributor('reports', 'report', {
        href: '/reports/new',
        label: 'Write the report yourself',
      }),
    }

    expect(KINDS.map((kind) => manualPath(kind, registry)?.href)).toEqual([
      '/queries/new',
      '/dashboards',
      '/kpis/new',
      '/reports/new',
      '/query-snippets',
    ])
    expect(KINDS.every((kind) => (manualPath(kind, registry)?.label.length ?? 0) > 0)).toBe(true)
  })

  // The table wins over a contribution for a kind it already owns, so a feature
  // cannot quietly redirect the community by-hand route out from under it.
  it('keeps the community route when a feature claims a kind the table owns', () => {
    const registry = {
      shadow: contributor('shadow', 'query', { href: '/elsewhere', label: 'Somewhere else' }),
    }

    expect(manualPath('query', registry)?.href).toBe('/queries/new')
  })

  // A build with no feature packages offers no escape hatch for their kinds
  // rather than a link into a 404. Run against a real empty registry, not a
  // mocked module, the same way the other registry seams are exercised.
  it('offers no by-hand route for a kind no installed feature owns', () => {
    expect(manualPath('kpi', {})).toBeNull()
    expect(manualPath('report', {})).toBeNull()
    expect(manualPath('query', {})?.href).toBe('/queries/new')
    expect(manualPath('dashboard', {})?.href).toBe('/dashboards')
    expect(manualPath('snippet', {})?.href).toBe('/query-snippets')
  })
})
