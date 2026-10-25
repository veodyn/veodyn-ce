import type { z } from 'zod'
import { chatDraftContributionFor } from '@/features/chat-drafts'
import { dashboardEditPayloadSchema } from './dashboard-changes'
import { chatProposalSchema, dashboardProposalSchema } from './frames'
import { operationPayloadSchema } from './operation-changes'
import { queryEditPayloadSchema } from './query-changes'
import { vizPayloadSchema } from './viz-changes'

export type DraftSlot =
  | 'drafts'
  | 'dashboardDrafts'
  | 'editDrafts'
  | 'vizDrafts'
  | 'dashboardEditDrafts'
  | 'operationDrafts'
  | 'contributedDrafts'

interface DraftKind {
  parse: (payload: unknown) => unknown
  slot: DraftSlot
}

const CLOSED_KINDS: Record<string, { schema: z.ZodTypeAny; slot: Exclude<DraftSlot, 'contributedDrafts'> }> = {
  query: { schema: chatProposalSchema, slot: 'drafts' },
  dashboard: { schema: dashboardProposalSchema, slot: 'dashboardDrafts' },
  query_edit: { schema: queryEditPayloadSchema, slot: 'editDrafts' },
  visualization: { schema: vizPayloadSchema, slot: 'vizDrafts' },
  dashboard_edit: { schema: dashboardEditPayloadSchema, slot: 'dashboardEditDrafts' },
  operation: { schema: operationPayloadSchema, slot: 'operationDrafts' },
}

export function draftKind(kind: string): DraftKind {
  if (Object.prototype.hasOwnProperty.call(CLOSED_KINDS, kind)) {
    const { schema, slot } = CLOSED_KINDS[kind]
    return {
      slot,
      parse: (payload) => {
        const parsed = schema.safeParse(payload)
        return parsed.success ? parsed.data : null
      },
    }
  }
  const contribution = chatDraftContributionFor(kind)
  return { slot: 'contributedDrafts', parse: (payload) => (contribution ? contribution.parse(payload) : payload) }
}
