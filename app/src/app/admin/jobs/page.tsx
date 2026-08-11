'use client'

import { AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RequireAdmin } from '@/components/auth/require-permission'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { USE_REAL_API } from '@/services/redash/config'
import { useAdminJobs } from '@/hooks/use-admin'
import { PageContainer } from '@/components/layout/page-container'
import { SkeletonCard } from '@/components/ui/skeleton-card'

function WorkerStateBadge({ state }: { state: string }) {
  // Title case, because every other badge in the product is ("On track",
  // "Breached", "Fresh", "Stale", "OK", "Draft", "In review") and these were the
  // only lowercase ones. RQ reports them lowercase, so the casing is applied
  // once here rather than at each branch: the fallback carries whatever state
  // the backend adds next, and it would otherwise be the new odd one out.
  const label = state.charAt(0).toUpperCase() + state.slice(1)

  if (state === 'busy') {
    return <Badge className="border-status-stale bg-status-stale/10 text-status-stale">{label}</Badge>
  }
  if (state === 'idle') {
    return <Badge className="border-status-fresh bg-status-fresh/10 text-status-fresh">{label}</Badge>
  }
  return <Badge variant="secondary">{label}</Badge>
}

export default function AdminJobsPage() {
  const { data: rq, isLoading, error } = useAdminJobs()

  const workers = rq?.workers ?? []
  const queues = Object.entries(rq?.queues ?? {})

  return (
    <RequireAdmin>
    <PageContainer>
      {/* "Background workers", not "RQ workers": Redis Queue is how this is
          built, not what the reader is looking at, and the acronym appears
          nowhere else in the product. */}
      <PageHeader title="Query Jobs" description="Background workers and the queue backlog." />
      {USE_REAL_API ? (
        <>
          {/* Card-shaped, because what follows is cards. The line of grey text
              this replaces sat where nothing would end up, so the page jumped
              on arrival and the wait read as an error message. */}
          {isLoading && (
            <div role="status" aria-label="Loading query jobs">
              <SkeletonCard lines={4} />
            </div>
          )}
          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{(error as Error).message}</AlertDescription>
            </Alert>
          )}
          <div className="bg-card rounded-lg border mb-6">
            <Table>
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Worker</TableHead>
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">State</TableHead>
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Queues</TableHead>
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">OK / Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workers.map((w) => (
                  <TableRow key={w.name} className="hover:bg-muted/30">
                    <TableCell className="px-4 py-3 font-mono text-xs">{w.name}</TableCell>
                    <TableCell className="px-4 py-3"><WorkerStateBadge state={w.state} /></TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{w.queues ?? '-'}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{w.successful_jobs ?? 0} / {w.failed_jobs ?? 0}</TableCell>
                  </TableRow>
                ))}
                {!isLoading && workers.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No workers reported</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="border-b">
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Queue</TableHead>
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Started</TableHead>
                  <TableHead className="text-xs font-mono font-medium text-muted-foreground uppercase tracking-wider px-4 py-3">Queued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queues.map(([name, q]) => (
                  <TableRow key={name} className="hover:bg-muted/30">
                    <TableCell className="px-4 py-3">{name}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{q.started?.length ?? 0}</TableCell>
                    <TableCell className="px-4 py-3 text-muted-foreground">{q.queued ?? 0}</TableCell>
                  </TableRow>
                ))}
                {!isLoading && queues.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="px-4 py-6 text-center text-muted-foreground">No queues reported</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        // The job queue is a property of the backend. There is nothing to
        // inspect without one, and the placeholder rows that used to sit here
        // named queries that exist in no instance.
        <div className="bg-card rounded-lg border p-6">
          <p className="text-sm font-medium">Queue status unavailable</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Workers and queue backlog are reported by the backend. Connect one to see the jobs this
            instance is running.
          </p>
        </div>
      )}
    </PageContainer>
    </RequireAdmin>
  )
}
