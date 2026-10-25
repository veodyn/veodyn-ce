'use client'

import Link from 'next/link'
import { InputWithCopy } from '@/components/shared/input-with-copy'
import { buttonVariants } from '@/components/ui/button'
import { useDashboard } from '@/hooks/use-dashboards'
import { useQueryById } from '@/hooks/use-queries'
import type { OperationResult } from '@/lib/chat/operation-apply'
import type { OperationPayload } from '@/lib/chat/operation-changes'
import { operationPublicUrl, targetHref } from '@/lib/chat/operation-links'
import type { ChatPromotion } from '@/lib/chat/wire'

export const LINK_GONE = 'This link is no longer active.'

const DONE_TEXT: Record<Exclude<OperationPayload['op'], 'fork' | 'share' | 'restore'>, string> = {
  archive: 'Archived.',
  favorite: 'Added to your favorites.',
  unfavorite: 'Removed from your favorites.',
  revoke: 'Link revoked.',
}

function useLiveToken(payload: OperationPayload): { token: string | null; pending: boolean } {
  const { target } = payload
  const dashboard = useDashboard(target.kind === 'dashboard' ? target.id : undefined)
  const query = useQueryById(target.kind === 'visualization' ? (target.queryId ?? undefined) : undefined)
  if (target.kind === 'dashboard') return { token: dashboard.data?.api_key ?? null, pending: dashboard.isPending }
  const chart = query.data?.visualizations?.find((one) => one.id === target.id) as { api_key?: string } | undefined
  return { token: chart?.api_key ?? null, pending: query.isPending }
}

function PublicLink({ url }: { url: string }) {
  return <InputWithCopy value={url} label="Public link" className="w-full" />
}

function LiveSharedLink({ payload }: { payload: OperationPayload }) {
  const { token, pending } = useLiveToken(payload)
  if (pending) return null
  if (!token) return <p className="text-sm text-muted-foreground">{LINK_GONE}</p>
  return <PublicLink url={operationPublicUrl(payload.target, payload.params, token)} />
}

function SharedLink({ payload, result }: { payload: OperationPayload; result: OperationResult | null }) {
  return result?.publicUrl ? <PublicLink url={result.publicUrl} /> : <LiveSharedLink payload={payload} />
}

interface OperationAppliedProps {
  payload: OperationPayload
  applied: ChatPromotion
  result: OperationResult | null
}

export function OperationApplied({ payload, applied, result }: OperationAppliedProps) {
  if (payload.op === 'fork') {
    const forkId = result?.forkId ?? applied.targetId
    return (
      <Link href={`/queries/${forkId}/source`} className={buttonVariants({ size: 'sm', variant: 'link' })}>
        Open the copy, query {forkId}
      </Link>
    )
  }
  if (payload.op === 'share') return <SharedLink payload={payload} result={result} />
  if (payload.op === 'restore') {
    return (
      <Link href={targetHref(payload.target)} className={buttonVariants({ size: 'sm', variant: 'link' })}>
        Restored. Open {payload.target.name}
      </Link>
    )
  }
  return <p className="text-sm text-muted-foreground">{DONE_TEXT[payload.op]}</p>
}
