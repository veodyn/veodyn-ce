'use client'

import { useQuery } from '@tanstack/react-query'
import { getThreadSubject } from '@/services/ai/chat-client'
import { useDashboard } from './use-dashboards'
import { useQueryById } from './use-queries'

export function useThreadSubjectLabel(threadId: string): string | undefined {
  const { data } = useQuery({
    queryKey: ['chat-thread-subject', threadId],
    queryFn: ({ signal }) => getThreadSubject(threadId, signal),
    staleTime: Infinity,
  })
  const subject = data?.subject ?? null
  const queryId = subject?.kind === 'query' || subject?.kind === 'visualization' ? subject.queryId : undefined
  const dashboardId = subject?.kind === 'dashboard' || subject?.kind === 'widget' ? subject.dashboardId : undefined
  const queryName = useQueryById(queryId).data?.name
  const dashboardName = useDashboard(dashboardId).data?.name

  if (!subject || subject.kind === 'new') return undefined
  const name = subject.kind === 'dataset' ? subject.datasetId : (queryName ?? dashboardName)
  return name ? `Ask about ${name}` : `Ask about this ${subject.kind}`
}
