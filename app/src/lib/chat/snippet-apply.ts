import { readQueryError } from '@/lib/query-error'
import { recordPromotion } from '@/services/ai/chat-client'
import { ApiError } from '@/services/api-client'
import * as snippets from '@/services/redash/snippets'
import { abandonPromotion, finishPromotion } from './promotion-lifecycle'
import type { ApplyOutcome } from './query-edit-apply'
import type { SnippetDraft, SnippetEditDraft } from './snippet-drafts'
import type { ChatPromotion } from './wire'

export const SNIPPET_CHANGED_SINCE_READ = 'This snippet changed after the chat read it.'

const FIRST_STEP = 0

async function begin(draftId: string, version: number, targetId?: string): Promise<ChatPromotion | string> {
  try {
    return await recordPromotion(draftId, {
      version,
      targetType: 'snippet',
      status: 'pending',
      ...(targetId === undefined ? {} : { targetId }),
    })
  } catch (error) {
    return readQueryError(error).message
  }
}

async function complete(
  draftId: string,
  promotion: ChatPromotion,
  targetId: string,
  updatedAt: string | undefined
): Promise<ApplyOutcome> {
  const sync = await finishPromotion(draftId, promotion, targetId, [
    { step: FIRST_STEP, outcome: 'done', targetId, ...(updatedAt === undefined ? {} : { updatedAt }) },
  ])
  return sync.synced
    ? { status: 'done', promotion: sync.promotion }
    : { status: 'unsynced', promotion: sync.promotion, patch: sync.patch }
}

export async function applySnippetCreate(draftId: string, version: number, payload: SnippetDraft): Promise<ApplyOutcome> {
  const promotion = await begin(draftId, version)
  if (typeof promotion === 'string') return { status: 'failed', error: promotion }
  try {
    const saved = await snippets.create(payload)
    return await complete(draftId, promotion, String(saved.id), saved.updated_at)
  } catch (error) {
    await abandonPromotion(draftId, promotion, [], FIRST_STEP, error)
    return { status: 'failed', error: readQueryError(error).message }
  }
}

export async function applySnippetEdit(
  draftId: string,
  version: number,
  payload: SnippetEditDraft,
  { overwrite }: { overwrite: boolean }
): Promise<ApplyOutcome> {
  const targetId = String(payload.snippetId)
  const promotion = await begin(draftId, version, targetId)
  if (typeof promotion === 'string') return { status: 'failed', error: promotion }
  const expected = overwrite ? undefined : payload.snapshot.updatedAt
  try {
    if (payload.delete) {
      await snippets.remove(payload.snippetId, expected)
      return await complete(draftId, promotion, targetId, undefined)
    }
    const saved = await snippets.update(payload.snippetId, payload.changes, expected)
    return await complete(draftId, promotion, targetId, saved.updated_at)
  } catch (error) {
    const conflict = error instanceof ApiError && error.status === 409
    await abandonPromotion(
      draftId,
      promotion,
      [],
      FIRST_STEP,
      conflict ? new Error(SNIPPET_CHANGED_SINCE_READ) : error
    )
    return conflict ? { status: 'conflict' } : { status: 'failed', error: readQueryError(error).message }
  }
}
