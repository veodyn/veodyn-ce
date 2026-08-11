'use client'

import { CheckCircle, AlertTriangle, HelpCircle, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RequireAdmin } from '@/components/auth/require-permission'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { USE_REAL_API } from '@/services/redash/config'
import { useFormats, type Formats } from '@/hooks/use-formats'
import { useAdminStatus, type AdminStatus } from '@/hooks/use-admin'
import { useConfig } from '@/components/config/config-provider'
import { PageContainer } from '@/components/layout/page-container'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

type Health = 'OK' | 'WARN' | 'UNKNOWN'

interface SystemRow {
  name: string
  status: Health
  detail: string
}

/** Redash reports epoch seconds as a string ("1784853987.30"). */
function formatEpochSeconds(value: string | undefined, formats: Formats): string {
  if (!value) return 'unknown'
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return 'unknown'
  return formats.dateTime(seconds * 1000)
}

function buildSystems(status: AdminStatus, formats: Formats): SystemRow[] {
  const outdated = Number(status.manager?.outdated_queries_count ?? 0)
  const queues = status.manager?.queues ?? {}
  const queued = Object.values(queues).reduce((sum, q) => sum + (q.size ?? 0), 0)
  const queueNames = Object.keys(queues)

  return [
    {
      name: 'Scheduler',
      status: status.manager?.last_refresh_at ? 'OK' : 'UNKNOWN',
      detail: status.manager?.last_refresh_at
        ? `Last run ${formatEpochSeconds(status.manager.last_refresh_at, formats)}, ${outdated} ${outdated === 1 ? 'query' : 'queries'} due`
        : 'The scheduler has not reported a run yet.',
    },
    {
      name: 'Queues',
      status: queueNames.length === 0 ? 'UNKNOWN' : queued > 0 ? 'WARN' : 'OK',
      detail:
        queueNames.length === 0
          ? 'No queues reported.'
          : `${queued} job${queued === 1 ? '' : 's'} waiting across ${queueNames.join(', ')}`,
    },
    {
      name: 'Redis',
      status: status.redis_used_memory_human ? 'OK' : 'UNKNOWN',
      detail: status.redis_used_memory_human
        ? `Reachable, using ${status.redis_used_memory_human}`
        : 'Redis did not report memory usage.',
    },
    {
      name: 'Content',
      status: 'OK',
      detail: `${status.queries_count ?? 0} queries, ${status.dashboards_count ?? 0} dashboards, ${status.query_results_count ?? 0} stored results`,
    },
  ]
}

const healthIcon = {
  OK: <CheckCircle className="h-5 w-5 text-status-fresh shrink-0" aria-hidden="true" />,
  WARN: <AlertTriangle className="h-5 w-5 text-status-stale shrink-0" aria-hidden="true" />,
  UNKNOWN: <HelpCircle className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />,
}

export default function AdminStatusPage() {
  const { brand } = useConfig()
  const { data: status, isLoading, isFetching, error, refetch, dataUpdatedAt } = useAdminStatus()
  const formats = useFormats()

  const systems = USE_REAL_API && status ? buildSystems(status, formats) : []

  return (
    <RequireAdmin>
      <PageContainer width="narrow">
        <PageHeader
          title="System Status"
          description="Whether the backend this instance talks to is reachable and healthy."
        />

        {!USE_REAL_API ? (
          // Never invent health. With no backend configured there is nothing to
          // report, and a page that can only say OK is worse than no page.
          <Card>
            <CardContent className="flex items-start gap-4">
              {healthIcon.UNKNOWN}
              <div>
                <div className="font-medium text-sm">Status unavailable</div>
                <p className="text-xs text-muted-foreground mt-1">
                  No backend is configured, so this instance&apos;s health cannot be checked. Set{' '}
                  <code>REDASH_URL</code> and <code>NEXT_PUBLIC_REDASH_URL</code> to connect one.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3 gap-4">
              <p className="text-xs text-muted-foreground">
                {isFetching
                  ? 'Checking…'
                  : dataUpdatedAt
                    ? // formats.dateTime, not toLocaleTimeString: the latter ignores
                      // Settings > Formats, so an org on 24h saw "6:08:17 PM" here
                      // beside a "Last run 29/07/26 18:07" that did honour it.
                      `Last checked ${formats.dateTime(dataUpdatedAt)}`
                    : 'Not checked yet'}
              </p>
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden="true" />
                {isFetching ? 'Checking…' : 'Check now'}
              </Button>
            </div>

            {isLoading && <div className="text-sm text-muted-foreground">Loading status…</div>}

            {error && (
              <Card>
                <CardContent className="flex items-start gap-4">
                  {healthIcon.WARN}
                  <div>
                    <div className="font-medium text-sm">Status could not be read</div>
                    <p className="text-xs text-muted-foreground mt-1">{(error as Error).message}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="space-y-3">
              {systems.map((s) => (
                <Card key={s.name}>
                  <CardContent className="flex items-center gap-4">
                    {healthIcon[s.status]}
                    <div>
                      <div className="font-medium text-sm">
                        {s.name}: {s.status}
                      </div>
                      <div className="text-xs text-muted-foreground">{s.detail}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}

        <Card className="mt-6">
          <CardContent>
            <h3 className={`${SUBSECTION_HEADING} mb-2`}>Version</h3>
            <p className="text-sm text-muted-foreground">
              {USE_REAL_API && status?.version ? `Query service ${status.version} · ` : ''}
              {brand.name} (Next.js Client)
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    </RequireAdmin>
  )
}
