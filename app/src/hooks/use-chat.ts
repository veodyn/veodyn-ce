'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useConfig } from '@/components/config/config-provider'
import { createThread, deleteThread, listThreads, updateThread } from '@/services/ai/chat-client'

export const CHAT_THREADS_KEY = ['chat-threads'] as const

export function useAiChatEnabled(): boolean {
  const { ai } = useConfig()
  return ai.enabled && ai.chat === true
}

export function useChatThreads(enabled: boolean) {
  return useQuery({
    queryKey: CHAT_THREADS_KEY,
    queryFn: ({ signal }) => listThreads(0, signal),
    enabled,
  })
}

export function useCreateChatThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => createThread(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY }),
  })
}

export function useUpdateChatThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { title?: string; pinned?: boolean } }) =>
      updateThread(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY }),
  })
}

export function useDeleteChatThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteThread(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHAT_THREADS_KEY }),
  })
}
