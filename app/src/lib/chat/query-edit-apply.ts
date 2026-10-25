import { readQueryError } from '@/lib/query-error'
import { patchPromotion, recordPromotion, type PromotionPatch } from '@/services/ai/chat-client'
import { ApiError } from '@/services/api-client'
import type { RedashQuery } from '@/services/redash/types'
import type { QueryChanges, QueryEditPayload } from './query-changes'
import { toNativeParameters } from './query-parameters'
import type { Draft } from './thread-model'
import type { RedashTransport } from './transport'
import type { ChatPromotion } from './wire'

export type EditDraft = Draft<QueryEditPayload>

export type ApplyOutcome =
  | { status: 'done'; promotion: ChatPromotion }
  | { status: 'unsynced'; promotion: ChatPromotion; patch: PromotionPatch }
  | { status: 'conflict' }
  | { status: 'failed'; error: string }

export const CHANGED_SINCE_READ = 'This query changed after the chat read it.'
export const NO_SUCH_VERSION = 'This edit has no such version.'

const FIRST_STEP = 0
const MAX_ERROR_CHARS = 500

function scheduleBody(schedule: NonNullable<QueryChanges['schedule']>) {
  return {
    interval: schedule.interval,
    time: schedule.time ?? null,
    day_of_week: schedule.dayOfWeek ?? null,
    until: schedule.until ?? null,
  }
}

async function nodeBody(
  queryId: number,
  changes: QueryChanges,
  transport: RedashTransport
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = {}
  if (changes.sql !== undefined) body.query = changes.sql
  if (changes.name !== undefined) body.name = changes.name
  if (changes.description !== undefined) body.description = changes.description ?? ''
  if (changes.dataSourceId !== undefined) body.data_source_id = changes.dataSourceId
  if (changes.tags !== undefined) body.tags = changes.tags
  if (changes.isDraft !== undefined) body.is_draft = changes.isDraft
  if (changes.schedule !== undefined) body.schedule = changes.schedule === null || !changes.schedule.interval ? null : scheduleBody(changes.schedule)
  if (changes.parameters !== undefined) {
    const current = await transport.get<RedashQuery>(`queries/${queryId}`)
    const existing = (current.options?.parameters ?? []) as unknown as Record<string, unknown>[]
    body.options = { ...current.options, parameters: toNativeParameters(changes.parameters, existing) }
  }
  return body
}

async function settle(draftId: string, promotion: ChatPromotion, patch: PromotionPatch): Promise<ChatPromotion> {
  try {
    return await patchPromotion(draftId, promotion.id, patch)
  } catch {
    return { ...promotion, ...patch, targetId: patch.targetId ?? promotion.targetId } as ChatPromotion
  }
}

export async function applyQueryEdit(
  draft: EditDraft,
  version: number,
  transport: RedashTransport,
  { overwrite }: { overwrite: boolean }
): Promise<ApplyOutcome> {
  const entry = draft.versions.find((one) => one.version === version)
  if (!entry) return { status: 'failed', error: NO_SUCH_VERSION }
  const { queryId, snapshot, changes } = entry.payload
  const targetId = String(queryId)

  let promotion: ChatPromotion
  try {
    promotion = await recordPromotion(draft.id, { version, targetType: 'query', targetId, status: 'pending' })
  } catch (error) {
    return { status: 'failed', error: readQueryError(error).message }
  }

  try {
    const body = await nodeBody(queryId, changes, transport)
    if (!overwrite) body.expected_updated_at = snapshot.updatedAt
    const saved = await transport.post<RedashQuery>(`queries/${queryId}`, body)
    const patch: PromotionPatch = {
      status: 'done',
      targetId,
      receipts: [{ step: FIRST_STEP, outcome: 'done', targetId, updatedAt: saved.updated_at }],
    }
    try {
      return { status: 'done', promotion: await patchPromotion(draft.id, promotion.id, patch) }
    } catch {
      return { status: 'unsynced', promotion: { ...promotion, ...patch } as ChatPromotion, patch }
    }
  } catch (error) {
    const conflict = error instanceof ApiError && error.status === 409
    const message = (conflict ? CHANGED_SINCE_READ : readQueryError(error).message).slice(0, MAX_ERROR_CHARS)
    await settle(draft.id, promotion, {
      status: 'failed',
      receipts: [{ step: FIRST_STEP, outcome: 'failed', error: message }],
    })
    return conflict ? { status: 'conflict' } : { status: 'failed', error: message }
  }
}
