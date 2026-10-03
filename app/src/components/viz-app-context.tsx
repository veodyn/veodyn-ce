'use client'

import type { ReactNode } from 'react'
import { buildPolicy, usePolicy } from '@/lib/policy'
import { ResultDownloadsProvider, type ResultDownloads } from '@veodyn/viz/lib/result-downloads'
import { useAuthStore } from '@/stores/auth-store'
import { useFormats } from '@/hooks/use-formats'
import { VizFormatsProvider } from '@veodyn/viz/lib/viz-formats'

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
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const formats = useFormats({ enabled: isAuthenticated })
  return (
    <VizFormatsProvider value={formats}>
      <ResultDownloadsProvider resolve={() => downloadsFor(buildPolicy(currentUser))}>{children}</ResultDownloadsProvider>
    </VizFormatsProvider>
  )
}
