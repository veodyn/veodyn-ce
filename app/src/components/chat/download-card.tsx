'use client'

import { Download } from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { knownOutput } from '@/lib/chat/thread-calls'
import type { CallView } from '@/lib/chat/thread-model'
import { downloadHref } from '@/lib/chat/tool-results-operation'
import { usePolicy } from '@/lib/policy'

const FORMATS = ['csv', 'xlsx'] as const

export const EXPORT_NOT_ALLOWED = 'Your account may not export data, so these links are withheld.'

export function DownloadCard({ call }: { call: CallView }) {
  const mayExport = usePolicy().canExportData()
  const known = knownOutput(call)
  const output = known?.kind === 'download' ? known : null
  const ready =
    output?.ok && output.queryId && output.format ? { queryId: output.queryId, format: output.format } : null
  return (
    <Card size="sm" className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Download className="size-4" aria-hidden="true" />
          <span>Download results</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-sm">
        {ready && !mayExport ? (
          <p className="text-pretty text-muted-foreground">{EXPORT_NOT_ALLOWED}</p>
        ) : ready ? (
          <>
            {[ready.format, ...FORMATS.filter((one) => one !== ready.format)].map((format, index) => (
              <a
                key={format}
                href={downloadHref(ready.queryId, format)}
                download
                className={buttonVariants({ size: 'sm', variant: index === 0 ? 'default' : 'outline' })}
              >
                {format.toUpperCase()}
              </a>
            ))}
            <Link href={`/queries/${ready.queryId}`} className={buttonVariants({ size: 'sm', variant: 'link' })}>
              Open query {ready.queryId}
            </Link>
          </>
        ) : call.status === 'running' ? (
          <p className="text-muted-foreground">Preparing the links…</p>
        ) : (
          <p className="text-pretty text-muted-foreground">{call.error ?? output?.error ?? 'No download.'}</p>
        )}
      </CardContent>
    </Card>
  )
}
