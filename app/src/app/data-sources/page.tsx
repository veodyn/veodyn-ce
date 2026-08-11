'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Database, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { DataSourceLogo } from '@/components/data-sources/data-source-logo'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NoData } from '@/components/ui/no-data'
import { ListLoadError } from '@/components/shared/list-load-error'
import { matchesSearch } from '@/lib/list-filter'
import { useDataSources } from '@/hooks/use-data-sources'
import { usePolicy } from '@/lib/policy'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

const typeIcons: Record<string, string> = {
  pg: 'PostgreSQL',
  mysql: 'MySQL',
  url: 'URL (JSON)',
  sqlite: 'SQLite',
  bigquery: 'BigQuery',
  redshift: 'Redshift',
  clickhouse: 'ClickHouse',
  mongodb: 'MongoDB',
}

export default function DataSourcesPage() {
  const { data: dataSources, isError, refetch } = useDataSources()
  const policy = usePolicy()
  const [search, setSearch] = useState('')

  const visible = (dataSources ?? []).filter((ds) =>
    matchesSearch(search, [ds.name, ds.type, typeIcons[ds.type]])
  )

  return (
    <PageContainer>
      <PageHeader
        title="Data Sources"
        description="The warehouses and APIs queries can be written against."
        action={
          policy.canCreateDataSource() ? (
            <Button render={<Link href="/data-sources/new" />}>
              <Plus className="h-4 w-4" />
              New Data Source
            </Button>
          ) : undefined
        }
      />
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search data sources"
        placeholder="Search by name or type..."
        count={visible.length}
        noun="data source"
      />
      {/* Same gap /destinations had: the grid rendered nothing at all under a
          "0 data sources" count. ENTITY_NAME_CLASS rather than a local
          font-display spelling, so a source is named the same way here as
          everywhere else it is listed. */}
      {isError ? (
        // Before this branch, a refused read rendered "No data sources yet. Add
        // one so queries have something to run against." An empty state that
        // instructs is the worst kind to show on a failure: it does not merely
        // misreport, it sends the reader off to fix a problem they do not have.
        <ListLoadError noun="data sources" onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <NoData
          icon={<Database className="h-8 w-8" />}
          message={
            search
              ? 'No data source matches that search.'
              : 'No data sources yet. Add one so queries have something to run against.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((ds) => (
            <Link key={ds.id} href={`/data-sources/${ds.id}`} className="block">
              <Card className="flex-row items-center gap-4 px-4 transition-colors hover:ring-primary/50">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
                  <DataSourceLogo
                    type={ds.type}
                    className="h-7 w-7 object-contain"
                    fallbackClassName="h-5 w-5 text-primary"
                  />
                </div>
                <div>
                  <h3 className={ENTITY_NAME_CLASS}>{ds.name}</h3>
                  <p className="text-xs text-muted-foreground">{typeIcons[ds.type] || ds.type}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
