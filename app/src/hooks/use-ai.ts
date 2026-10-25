'use client'

import { useMutation } from '@tanstack/react-query'
import { useConfig } from '@/components/config/config-provider'
import * as aiService from '@/services/ai/client'
import type { GenerateSqlRequest } from '@/types/ai'

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
