'use client'

import Link from 'next/link'
import { AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RequireAdmin } from '@/components/auth/require-permission'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { NoData } from '@/components/ui/no-data'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { USE_REAL_API } from '@/services/redash/config'
import { useOutdatedQueries } from '@/hooks/use-admin'
import { PageContainer } from '@/components/layout/page-container'
import { SkeletonCard } from '@/components/ui/skeleton-card'

export default function AdminOutdatedPage() {
  const { data, isLoading, error } = useOutdatedQueries()
  const queries = data?.queries ?? []

  return (
    <RequireAdmin>
    <PageContainer>
      <PageHeader title="Outdated Queries" description="Scheduled queries whose results are past their refresh interval." />
      {/* Table-shaped, because a table is what arrives. The line of grey text
          this replaces sat where nothing would end up. */}
      {USE_REAL_API && isLoading && (
        <div role="status" aria-label="Loading outdated queries">
          <SkeletonCard lines={5} />
        </div>
      )}
      {USE_REAL_API && error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      )}
      {queries.length > 0 ? (
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="border-b">
                <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Query</TableHead>
                <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Last Retrieved</TableHead>
                <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Interval</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queries.map((q) => (
                <TableRow key={q.id} className="hover:bg-muted/30">
                  <TableCell className="px-4 py-3"><Link href={`/queries/${q.id}`} className="hover:text-primary">{q.name}</Link></TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{q.retrieved_at ?? 'never'}</TableCell>
                  <TableCell className="px-4 py-3 text-muted-foreground">{q.schedule?.interval ? `${q.schedule.interval}s` : '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        !isLoading && <NoData card message="No outdated queries found." />
      )}
    </PageContainer>
    </RequireAdmin>
  )
}
