import type { AiDatasetColumn, GenerateSqlRequest, GenerateSqlResponse } from '@/types/ai'
import type { ConverseRequest, ConverseResponse } from '@/types/ai-create'
import { CONVERSE_SCRIPT } from './ai-mock-script'
import { assertSafeSqlIdentifier, isNumericSqlType, isSafeSqlIdentifier } from './sql-safety'

// Deterministic stand-in for a model, so the AI surfaces are demoable without a
// live provider (AI spec sections 1, 9). Picks a plausible column set from the
// grounding and echoes the prompt as a rationale.
//
// Deterministic means exactly that: the same request always yields the same
// response. No Math.random, no clock, no ambient state.
//
// The grounding arrives as a POST body, so the table and the column names are
// untrusted. The table name has to be an identifier or there is no query to
// generate (refused); column names that are not identifiers are dropped rather
// than emitted. The prompt only ever reaches the rationale, never the SQL.

const ROW_LIMIT = 100

export function mockGenerateSql(req: GenerateSqlRequest): GenerateSqlResponse {
  const table = assertSafeSqlIdentifier(req?.dataset?.table, 'dataset table', 3)
  const columns = (Array.isArray(req?.dataset?.columns) ? req.dataset.columns : []).filter(
    (c: AiDatasetColumn) => isSafeSqlIdentifier(c?.name, 1)
  )
  const prompt = typeof req?.prompt === 'string' ? req.prompt : ''

  // First non-numeric column is the dimension, first numeric one the measure:
  // stable ordering in, stable choice out.
  const dimension = columns.find((c) => !isNumericSqlType(c.type))?.name
  const measure = columns.find((c) => isNumericSqlType(c.type))?.name

  let select = '*'
  let group = ''
  let order = ''
  if (dimension && measure) {
    select = `${dimension}, sum(${measure}) AS ${measure}_total`
    group = `\nGROUP BY ${dimension}`
    order = `\nORDER BY ${measure}_total DESC`
  } else if (measure) {
    select = `sum(${measure}) AS ${measure}_total`
  } else if (dimension) {
    select = dimension
    order = `\nORDER BY ${dimension}`
  }

  return {
    sql: `SELECT ${select}\nFROM ${table}${group}${order}\nLIMIT ${ROW_LIMIT}`,
    rationale: `Generated from the prompt "${prompt}" grounded in ${table} (${columns.length} columns). Review the SQL before trusting the result.`,
  }
}

// ── Create-with-AI conversation (spec section 8) ────────────────────────────
//
// The fixtures themselves live in ai-mock-script.ts; what is left here is the
// interview, which is the part with behaviour.

// The user's own words are quoted back so the demo reads like a conversation,
// bounded so a 4,000-character turn cannot become a 4,000-character reply.
const ECHO_CHARS = 120

function echoGoal(messages: ConverseRequest['messages']): string {
  const first = messages.find((m) => m?.role === 'user')?.content
  if (typeof first !== 'string' || first.length === 0) return ''
  const trimmed = first.trim()
  const clipped = trimmed.length > ECHO_CHARS ? `${trimmed.slice(0, ECHO_CHARS)}...` : trimmed
  return `Got it: "${clipped}". `
}

/**
 * A two-turn scripted interview: one follow-up while the transcript holds a
 * single user message, then the kind's fixed proposal. Pure, and keyed only off
 * the transcript, so the same conversation always reaches the same proposal.
 */
export function mockConverse(payload: ConverseRequest): ConverseResponse {
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  const script = CONVERSE_SCRIPT[payload?.kind] ?? CONVERSE_SCRIPT.query
  const userTurns = messages.filter((m) => m?.role === 'user').length

  if (userTurns <= 1) {
    return {
      reply: `${echoGoal(messages)}${script.question}`,
      suggestedAnswers: script.suggestedAnswers,
      ready: false,
      proposal: null,
      // Named on the interview turn too, not only with the proposal: the point
      // of the round trip is that the table is settled BEFORE anything is
      // proposed over it.
      focusTable: script.focusTable,
    }
  }

  return {
    reply: script.readyReply,
    suggestedAnswers: [],
    ready: true,
    proposal: script.proposal,
    focusTable: script.focusTable,
  }
}
