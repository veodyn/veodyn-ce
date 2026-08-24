'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Send } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { DestinationIcon } from '@/components/destinations/destination-icon'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NoData } from '@/components/ui/no-data'
import { ListLoadError } from '@/components/shared/list-load-error'
import { matchesSearch } from '@/lib/list-filter'
import { useDestinations } from '@/hooks/use-destinations'
import { PageContainer } from '@/components/layout/page-container'
import { ENTITY_NAME_CLASS } from '@/lib/entity-name'

export default function DestinationsPage() {
  const { data: destinations, isError, refetch } = useDestinations()
  const [search, setSearch] = useState('')

  const visible = (destinations ?? []).filter((d) => matchesSearch(search, [d.name, d.type]))

  return (
    <PageContainer>
      <PageHeader
        title="Alert Destinations"
        description="Where a triggered alert sends its notification."
        action={
          <Button render={<Link href="/destinations/new" />}>
            <Plus className="h-4 w-4" />
            New Destination
          </Button>
        }
      />
      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        searchLabel="Search destinations"
        placeholder="Search by name or type..."
        count={visible.length}
        noun="destination"
      />
      {/* This page used to render the toolbar, then nothing: an empty grid over
          a "0 destinations" count, on a route whose whole job is to say where
          alerts go. Two messages rather than one, because "you have none" and
          "your search excluded them all" are different problems and a single
          "no data" over a filtered list reads as data loss. */}
      {isError ? (
        // The third instructing empty state to gain this branch: "Add one so a
        // triggered alert has somewhere to go" was also what a refused read
        // looked like.
        <ListLoadError noun="alert destinations" onRetry={() => refetch()} />
      ) : visible.length === 0 ? (
        <NoData
          icon={<Send className="h-8 w-8" />}
          message={
            search
              ? 'No destination matches that search.'
              : 'No alert destinations yet. Add one so a triggered alert has somewhere to go.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map((d) => (
            <Link key={d.id} href={`/destinations/${d.id}`} className="block">
              <Card className="h-full flex-row items-center gap-4 px-4 transition-colors hover:ring-primary/50">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center">
                  <DestinationIcon type={d.type} className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <h3 className={`${ENTITY_NAME_CLASS} wrap-break-word`}>{d.name}</h3>
                  <p className="text-xs text-muted-foreground capitalize">{d.type}</p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </PageContainer>
  )
}
