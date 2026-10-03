'use client'

import type { ReactNode } from 'react'
import { buildPolicy, usePolicy } from '@/lib/policy'
import { ResultDownloadsProvider, type ResultDownloads } from '@/lib/result-downloads'
import { useAuthStore } from '@/stores/auth-store'

function downloadsFor(policy: ReturnType<typeof buildPolicy>, queryId?: number): ResultDownloads | undefined {
  if (!policy.canExportData()) return undefined
  if (queryId == null) return { csv: true, tsv: true }
  return { csv: true, tsv: true, xlsxHref: `/api/node/queries/${queryId}/results.xlsx` }
}

export function useAppResultDownloads(queryId?: number): ResultDownloads | undefined {
  return downloadsFor(usePolicy(), queryId)
}

export function VizAppContext({ children }: { children: ReactNode }) {
  const currentUser = useAuthStore((s) => s.currentUser)
  return (
    <ResultDownloadsProvider resolve={() => downloadsFor(buildPolicy(currentUser))}>{children}</ResultDownloadsProvider>
  )
}
