'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Radio } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ConnectorHealthBadge } from '@/components/connectors/connector-health'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NoData } from '@/components/ui/no-data'
import { ListLoadError } from '@/components/shared/list-load-error'
import { matchesSearch } from '@/lib/list-filter'
import { useConnectors } from '@/hooks/use-connectors'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

export default function ConnectorsPage() {
  const { data: connectors, isError, refetch } = useConnectors()
  const [search, setSearch] = useState('')

  const visible = (connectors ?? []).filter((c) => matchesSearch(search, [c.name, c.displayName]))

  return (
    <PageContainer>
      <PageHeader
        title="Connectors"
        description="Where this agency's own identity is attached to an outbound channel."
        action={
          <Button render={<Link href="/connectors/new" />}>
            <Plus className="h-4 w-4" />
            New Connector
          </Button>
        }
      />
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search connectors"
        placeholder="Search by name or channel..."
        count={visible.length}
        noun="connector"
      />
      {isError ? (
        <ListLoadError noun="connectors" onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <NoData
          icon={<Radio className="h-8 w-8" />}
          message={
            search
              ? 'No connector matches that search.'
              : 'No connectors configured. Add one so an approved message has a channel to reach riders on.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((c) => (
            <Link key={c.connectorId} href={`/connectors/${encodeURIComponent(c.connectorId)}`} className="block">
              <Card className="h-full flex-row items-center gap-4 px-4 transition-colors hover:ring-primary/50">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Radio className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className={`${ENTITY_NAME_CLASS} wrap-break-word`}>{c.name}</h3>
                  <p className="text-xs text-muted-foreground">{c.displayName}</p>
                </div>
                <ConnectorHealthBadge health={c.health} />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
