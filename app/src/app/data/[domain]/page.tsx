'use client'

// Route invariant: no domain key may be "dataset" - /data/dataset/* is the dataset detail route and its static segment wins over this dynamic one.

import { use } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardHeader } from '@/components/ui/card'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { HubCounterRow } from '@/components/catalog/hub-counter-row'
import { DatasetCard } from '@/components/catalog/dataset-card'
import { useDomainHub, useCatalog } from '@/hooks/use-catalog'
import { useDashboards } from '@/hooks/use-dashboards'
import { resolveDomainIcon } from '@/lib/sidebar-nav'
import { PageContainer } from '@/components/layout/page-container'
import { SECTION_HEADING } from '@/lib/section-heading'
import { useConfig } from '@/components/config/config-provider'

export default function DomainHubPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = use(params)
  const { domains } = useConfig()
  const { data: hub, isLoading, isError } = useDomainHub(domain)
  const { data: datasets, isLoading: datasetsLoading } = useCatalog()
  const { data: dashboardsPage, isLoading: dashboardsLoading } = useDashboards()

  // The instance config is the registry: a domain exists here if and only if it
  // is configured. Checked before anything is fetched, because the catalog
  // service deliberately does not 404 an unknown key. It has no registry of its
  // own (see veodyn_api/routers/domains.py), so it cannot tell "not a domain"
  // from "a domain nothing is filed under yet" and answers with an empty hub
  // built from the slug. That made every string under /data/ render as a real
  // hub, title-cased so the fabricated page looked deliberate, and it made the
  // honest empty state unreadable: "No datasets in this domain" meant both
  // "this domain has none" and "there is no such domain".
  //
  // The check belongs here rather than in the backend because this is the side
  // that holds the list. It also matches what the reader already sees: the
  // sidebar builds its domain rows from this same config, so a key that is not
  // in it has no nav row either.
  const isConfiguredDomain = domains.some((d) => d.key === domain)
  if (!isConfiguredDomain) {
    return (
      <PageContainer>
        <NoData message="Domain not found" />
      </PageContainer>
    )
  }

  if (isLoading) {
    return (
      <PageContainer>
        <SkeletonCard />
      </PageContainer>
    )
  }

  if (isError) {
    return (
      <PageContainer>
        <NoData message="Unable to load this domain. The catalog service may be unavailable." />
      </PageContainer>
    )
  }

  if (!hub) {
    return (
      <PageContainer>
        <NoData message="Domain not found" />
      </PageContainer>
    )
  }

  // Gate the datasets and dashboards sections on their own loading so real-API
  // mode does not flash an empty section before those queries resolve. The hub
  // itself is already resolved above, so a missing hub still shows NoData first.
  if (datasetsLoading || dashboardsLoading) {
    return (
      <PageContainer>
        <SkeletonCard />
      </PageContainer>
    )
  }

  // Wrapped in an object (rather than a bare `const Icon = ...`) so the JSX
  // below reads it via member access. `resolveDomainIcon` returns a stable,
  // already-defined icon component (never one created fresh per render), but
  // the lint rule guarding against defining components during render cannot
  // tell the difference from the bare-identifier form (see app-sidebar.tsx's
  // `item.icon` for the same pattern).
  const domainIcon = { Component: resolveDomainIcon(hub.icon) }

  const resolvedDatasets = hub.datasetIds
    .map((id) => datasets?.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => d != null)

  // Render a link for every hub.dashboardId, even one whose name has not
  // loaded yet: dashboardsPage is only the first page of results, so in real
  // mode a linked dashboard beyond page 1 must not silently disappear from
  // the hub. Fall back to a stable label when the name is not available.
  const resolvedDashboards = hub.dashboardIds.map((id) => ({
    id,
    name: dashboardsPage?.results.find((d) => d.id === id)?.name ?? `Dashboard ${id}`,
  }))

  return (
    <PageContainer>
      <div className="mb-6 flex items-center gap-3">
        <domainIcon.Component className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        <PageHeader title={hub.label} className="mb-0 flex-1" />
      </div>

      <HubCounterRow counters={hub.counters} />

      <div className="mt-8">
        <h2 className={`${SECTION_HEADING} mb-3`}>Datasets</h2>
        {resolvedDatasets.length === 0 ? (
          <NoData message="No datasets in this domain." />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {resolvedDatasets.map((dataset) => (
              <DatasetCard key={dataset.id} dataset={dataset} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className={`${SECTION_HEADING} mb-3`}>Dashboards</h2>
        {resolvedDashboards.length === 0 ? (
          <NoData message="No dashboards linked to this domain." />
        ) : (
          <div className="space-y-2">
            {resolvedDashboards.map((dashboard) => (
              <Link key={dashboard.id} href={`/dashboards/${dashboard.id}`} className="block">
                <Card className="transition-colors hover:ring-primary/50">
                  <CardHeader>
                    <h3 className="font-display font-medium">{dashboard.name}</h3>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  )
}
