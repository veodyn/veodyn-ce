'use client'

import { useConfig } from '@/components/config/config-provider'

export function useAiChatEnabled(): boolean {
  const { ai } = useConfig()
  return ai.enabled && ai.chat === true
}
