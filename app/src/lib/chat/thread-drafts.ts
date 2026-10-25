import { isOpenDraft, type DraftFrame } from './frames'
import { draftKind, type DraftSlot } from './draft-kinds'
import { upsertPromotion } from './promotions'
import { withVersion } from './thread-stored'
import type { ContributedDraftView, Draft, ThreadState } from './thread-model'
import type { ChatPromotion } from './wire'

function putContributedDraft(state: ThreadState, draftId: string, version: number, kind: string, payload: unknown) {
  const parsed = draftKind(kind).parse(payload)
  const held = state.contributedDrafts[draftId] ?? { id: draftId, kind, versions: [], promotions: [] }
  const next: ContributedDraftView =
    parsed === null ? held : { ...withVersion(held, draftId, version, parsed), kind: held.kind }
  return { ...state, contributedDrafts: { ...state.contributedDrafts, [draftId]: next } }
}

function putIn(
  state: ThreadState,
  slot: Exclude<DraftSlot, 'contributedDrafts'>,
  draftId: string,
  version: number,
  payload: unknown
): ThreadState {
  const held = state[slot] as Record<string, Draft<unknown>>
  return { ...state, [slot]: { ...held, [draftId]: withVersion(held[draftId], draftId, version, payload) } }
}

export function putDraft(state: ThreadState, frame: DraftFrame): ThreadState {
  const { draftId, version } = frame
  if (isOpenDraft(frame)) return putContributedDraft(state, draftId, version, frame.kind, frame.payload)
  const slot = draftKind(frame.kind).slot
  if (slot === 'contributedDrafts') return state
  return putIn(state, slot, draftId, version, frame.payload)
}

function promoteIn(slot: DraftSlot) {
  return (state: ThreadState, draftId: string, promotion: ChatPromotion): ThreadState => {
    const held = state[slot] as Record<string, Draft<unknown>>
    const draft = held[draftId]
    if (!draft) return state
    return { ...state, [slot]: { ...held, [draftId]: { ...draft, promotions: upsertPromotion(draft.promotions, promotion) } } }
  }
}

export const addPromotion = promoteIn('drafts')
export const addDashboardPromotion = promoteIn('dashboardDrafts')
export const addEditPromotion = promoteIn('editDrafts')
export const addVizPromotion = promoteIn('vizDrafts')
export const addDashboardEditPromotion = promoteIn('dashboardEditDrafts')
export const addContributedPromotion = promoteIn('contributedDrafts')
export const addOperationPromotion = promoteIn('operationDrafts')
