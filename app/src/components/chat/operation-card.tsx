'use client'

import { Archive, ArchiveRestore, GitFork, Link2, Link2Off, Star, StarOff, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import type { OperationPayload } from '@/lib/chat/operation-changes'
import { targetHref } from '@/lib/chat/operation-links'
import type { OperationDraftView } from '@/lib/chat/thread-model'

const KIND_NOUN = { query: 'query', dashboard: 'dashboard', visualization: 'chart' } as const

const ICONS: Record<OperationPayload['op'], LucideIcon> = {
  fork: GitFork,
  archive: Archive,
  restore: ArchiveRestore,
  favorite: Star,
  unfavorite: StarOff,
  share: Link2,
  revoke: Link2Off,
}

export function operationTitle(payload: OperationPayload): string {
  const noun = KIND_NOUN[payload.target.kind]
  switch (payload.op) {
    case 'fork':
      return 'Fork query'
    case 'archive':
      return `Archive ${noun}`
    case 'restore':
      return `Restore ${noun}`
    case 'favorite':
      return 'Add to favorites'
    case 'unfavorite':
      return 'Remove from favorites'
    case 'share':
      return payload.target.kind === 'visualization' ? 'Publish chart' : 'Create public link'
    case 'revoke':
      return 'Revoke public link'
  }
}

export function payloadAt(draft: OperationDraftView, version: number): OperationPayload | undefined {
  return (draft.versions.find((one) => one.version === version) ?? draft.versions.at(-1))?.payload
}

interface OperationCardProps {
  draft: OperationDraftView
  version: number
  children?: ReactNode
}

export function OperationCard({ draft, version, children }: OperationCardProps) {
  const payload = payloadAt(draft, version)
  if (!payload) return null
  const Icon = ICONS[payload.op]
  const { summary, consequence } = payload.params
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4" aria-hidden="true" />
          <span>{operationTitle(payload)}</span>
          <Link href={targetHref(payload.target)} className="truncate hover:underline">
            {payload.target.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1 text-sm">
        {summary ? <p className="text-pretty">{summary}</p> : null}
        {consequence ? <p className="text-pretty text-muted-foreground">{consequence}</p> : null}
      </CardContent>
      {children ? <CardFooter className="flex flex-wrap gap-2">{children}</CardFooter> : null}
    </Card>
  )
}
