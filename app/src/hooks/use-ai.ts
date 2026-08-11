'use client'

// The AI hooks a build with no enterprise pack still has something to point at.
//
// The other four went to ./use-report-ai.ts in the EE-3 Task 6e split, and the
// line runs between them cleanly: everything here answers an endpoint the
// community edition ships, everything there answers one of the four
// src/app/api/ai/* route directories the pack takes with it.
//
// useConverse is on this side even though the conversation can converge on a
// KPI or a report, and that is not an oversight. The proposal CONTRACT is
// community: veodyn_api's schemas/ai_create.py ships KpiProposalOut and
// ReportProposalOut to a build with no endpoint to create either, so a
// community browser really does receive them. What it does not have is a card
// to render one, and that arrives through FeatureDescriptor.proposals. Task 4's
// notes make the argument at length.
import { useMutation } from '@tanstack/react-query'
import { useConfig } from '@/components/config/config-provider'
import * as aiService from '@/services/ai/client'
import * as converseService from '@/services/ai/converse-client'
import type { GenerateSqlRequest } from '@/types/ai'
import type { ConverseRequest } from '@/types/ai-create'

export function useAiEnabled(): boolean {
  return useConfig().ai.enabled
}

// Variables may carry an AbortSignal so a caller can cancel a superseded or
// unmounted generation. It is optional and stripped before the request body, so
// a plain-request caller keeps working unchanged.
export type GenerateSqlVariables = GenerateSqlRequest & { signal?: AbortSignal }

export function useGenerateSql() {
  return useMutation({
    mutationFn: ({ signal, ...request }: GenerateSqlVariables) =>
      aiService.generateSql(request, { signal }),
  })
}

// One turn of a Create-with-AI conversation. Same optional-signal contract: the
// chat aborts the turn in flight when the modal closes or a newer turn
// supersedes it, so a stale reply can never land in the transcript.
export type ConverseVariables = ConverseRequest & { signal?: AbortSignal }

export function useConverse() {
  return useMutation({
    mutationFn: ({ signal, ...request }: ConverseVariables) =>
      converseService.converse(request, { signal }),
  })
}
