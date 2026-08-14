// Every decision the Create-with-AI chat makes that does not need React: what
// the transcript becomes after a turn, whether the composer may send, what the
// dialog is called, and where the manual path goes. Kept here so the turn cap
// and the wire projection can be tested without rendering anything (the
// proposal-model and report-outline-model precedent).
import { proposalContributionFor } from '@/features/proposals'
import type { ProposalManualPath } from '@/features/proposal-types'
import type { FeatureDescriptor } from '@/features/types'
import { isAppError } from '@/lib/errorIds'
import {
  MAX_MESSAGE_CHARS,
  MAX_USER_TURNS,
  type ConverseMessage,
  type CreateKind,
} from '@/types/ai-create'

/**
 * One bubble on screen. Richer than a `ConverseMessage` because the UI also
 * holds things the wire does not carry: the chips offered with a reply, and a
 * failure this client wrote itself.
 */
export interface ChatTurn {
  /**
   * The React key. Allocated by the caller from a counter that only ever goes
   * up, never from the array's length: a retry drops the failure bubble, and a
   * length-derived key would hand the reply that replaces it the key React
   * already rendered the failure under.
   */
  seq: number
  role: 'user' | 'assistant'
  content: string
  suggestedAnswers: string[]
  /** True when this bubble reports a failed turn rather than a model reply. */
  failed: boolean
}

export type NewChatTurn = Omit<ChatTurn, 'seq'>

export function userTurn(content: string): NewChatTurn {
  return { role: 'user', content, suggestedAnswers: [], failed: false }
}

export function assistantTurn(reply: string, suggestedAnswers: string[]): NewChatTurn {
  return { role: 'assistant', content: reply, suggestedAnswers, failed: false }
}

// Our own words, never the model's: a failure has no reply to show, and the
// registry id travels with it so a support request has something to grep for.
export function failedTurn(error: unknown): NewChatTurn {
  return { role: 'assistant', content: turnErrorText(error), suggestedAnswers: [], failed: true }
}

export function turnErrorText(error: unknown): string {
  const base = 'The AI could not answer that turn.'
  if (isAppError(error)) return `${base} ${error.message} [${error.id}]`
  if (error instanceof Error) return `${base} ${error.message}`
  return base
}

export function appendTurn(turns: ChatTurn[], turn: NewChatTurn, seq: number): ChatTurn[] {
  return [...turns, { ...turn, seq }]
}

/**
 * Drop the failure bubbles at the end of the transcript, so a retry re-sends
 * the turn that failed instead of asking the user to type it again. Only the
 * trailing run: an earlier failure the conversation recovered from is history.
 */
export function dropTrailingFailures(turns: ChatTurn[]): ChatTurn[] {
  let end = turns.length
  while (end > 0 && turns[end - 1].failed) end -= 1
  return end === turns.length ? turns : turns.slice(0, end)
}

export function countUserTurns(turns: ChatTurn[]): number {
  return turns.filter((turn) => turn.role === 'user').length
}

export function isAtTurnCap(turns: ChatTurn[]): boolean {
  return countUserTurns(turns) >= MAX_USER_TURNS
}

/**
 * The transcript as the endpoint sees it. Failure bubbles are this client's own
 * text, so sending them back would ask the model to account for words it never
 * said, and would spend the message budget doing it.
 *
 * No truncation, deliberately: the cap above bounds this at MAX_USER_TURNS user
 * messages and at most one reply each, which stays inside
 * MAX_TRANSCRIPT_MESSAGES. Dropping the opening turns instead would lose the
 * goal, and a model that has forgotten the goal is worse than an honest stop
 * (spec section 4.3).
 */
export function toConverseMessages(turns: ChatTurn[]): ConverseMessage[] {
  return turns
    .filter((turn) => !turn.failed)
    .map((turn) => ({ role: turn.role, content: turn.content }))
}

export interface ComposerState {
  disabled: boolean
  /** Shown to the user when the reason is worth words. Null when it is not. */
  notice: string | null
  /** The cap is the one lock that offers the manual path instead. */
  atCap: boolean
}

export const TURN_CAP_NOTICE = `This conversation has used all ${MAX_USER_TURNS} turns. Close it and start again, or create this yourself.`

export function composerState(args: {
  turns: ChatTurn[]
  sending: boolean
  creating: boolean
}): ComposerState {
  if (isAtTurnCap(args.turns)) {
    return { disabled: true, notice: TURN_CAP_NOTICE, atCap: true }
  }
  if (args.creating) {
    return {
      disabled: true,
      // The panel below is mid-write. Saying so beats a field that has gone
      // grey for no stated reason.
      notice: 'Creating what you approved below.',
      atCap: false,
    }
  }
  // A pending turn already announces itself through the send button's busy
  // state, so a second line of prose would only repeat it.
  return { disabled: args.sending, notice: null, atCap: false }
}

export function canSend(draft: string, state: ComposerState): boolean {
  const text = draft.trim()
  return !state.disabled && text.length > 0 && text.length <= MAX_MESSAGE_CHARS
}

const KIND_COPY: Record<CreateKind, { title: string; opening: string; placeholder: string }> = {
  query: {
    title: 'Create a query with AI',
    opening: 'Tell me what you want to find out and I will work out which table answers it.',
    placeholder: 'What do you want to find out?',
  },
  dashboard: {
    title: 'Create a dashboard with AI',
    opening:
      'Tell me what this dashboard is for. I assemble it from queries that already exist.',
    placeholder: 'What should this dashboard show?',
  },
  kpi: {
    title: 'Create a KPI with AI',
    opening: 'Tell me which number you want to track and what good looks like.',
    placeholder: 'What number do you want to track?',
  },
  report: {
    title: 'Create a report with AI',
    opening: 'Tell me what this report should explain and who reads it.',
    placeholder: 'What should this report explain?',
  },
  snippet: {
    title: 'Create a snippet with AI',
    opening: 'Tell me what the snippet should insert and what should trigger it.',
    placeholder: 'What should the snippet insert?',
  },
}

export function dialogTitle(kind: CreateKind): string {
  return KIND_COPY[kind].title
}

/** The assistant's opening line, before any turn. Static copy, not model output. */
export function openingPrompt(kind: CreateKind): string {
  return KIND_COPY[kind].opening
}

export function composerPlaceholder(kind: CreateKind): string {
  return KIND_COPY[kind].placeholder
}

export type ManualPath = ProposalManualPath

// Where the user goes when the AI cannot help: the turn cap, or a provider that
// will not answer. Dashboards and snippets point at their library page because
// neither has a /new route to point at.
//
// The COMMUNITY kinds only, and no longer a total Record<CreateKind, ...>.
// CreateKind names all five because the service contract does (see
// types/ai-create.ts), so a total table here meant a community build holding a
// link to /kpis/new with no such route in it. The two feature kinds bring their
// own through FeatureDescriptor.proposals, which is already the thing that
// decides whether this build can draw that kind at all.
const MANUAL_PATHS: Partial<Record<CreateKind, ManualPath>> = {
  query: { href: '/queries/new', label: 'Write the query yourself' },
  dashboard: { href: '/dashboards', label: 'Build the dashboard yourself' },
  snippet: { href: '/query-snippets', label: 'Write the snippet yourself' },
}

/**
 * The by-hand route for this kind, or null if this build has none to offer.
 *
 * Null is a real answer and not a failure: a build with no KPI package has no
 * page that creates a KPI, and offering the link anyway is the defect. Callers
 * render the rest of the affordance (Try again, the turn-cap notice) without
 * it.
 *
 * Takes the registry as an optional final parameter, the same way featureList
 * and assembleSearchSources do, so a test can exercise the community-only path
 * for real instead of mocking the registry module.
 */
export function manualPath(
  kind: CreateKind,
  registry?: Record<string, FeatureDescriptor>
): ManualPath | null {
  return MANUAL_PATHS[kind] ?? proposalContributionFor(kind, registry)?.manual ?? null
}

export const DISCARD_CONFIRM = {
  title: 'Discard this proposal?',
  description:
    'Nothing has been created yet, and this conversation is not saved. Closing now discards both.',
  confirmLabel: 'Discard',
} as const
