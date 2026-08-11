'use client'

import { use } from 'react'
import { usePublicDashboard } from '@/hooks/use-dashboards'
import { DashboardGrid } from '@/components/dashboard/dashboard-grid'
import { USE_REAL_API } from '@/services/redash/config'
import { PageContainer } from '@/components/layout/page-container'
import { PageLoading } from '@/components/layout/page-loading'
import { PageHeader } from '@/components/layout/page-header'
import { NoData } from '@/components/ui/no-data'

export default function PublicDashboardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { data: dashboard, isLoading } = usePublicDashboard(token)

  // Every branch titles itself. This route used to render a heading only once a
  // real backend returned a dashboard, so the mock and revoked-link states were
  // pages with no h1 at all.
  if (!USE_REAL_API) {
    return (
      <PageContainer>
        <PageHeader
          title="Shared dashboard"
          description="Connect a real query service to use share links."
        />
        <NoData message="Public dashboard view is unavailable in mock mode." />
      </PageContainer>
    )
  }

  // A shared link is often the first thing a recipient sees of this product, and
  // a line of grey text on a white page is what a broken link looks like.
  if (isLoading) {
    return <PageLoading rows={4} label="Loading shared dashboard" />
  }

  if (!dashboard) {
    return (
      <PageContainer>
        <PageHeader title="Shared dashboard" />
        <NoData message="This dashboard is not available. The share link may have been revoked." />
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {/* PageHeader, not a hand-rolled h1: this was text-2xl font-semibold
          against the font-display font-medium every other page title uses. */}
      <PageHeader title={dashboard.name} />
      <DashboardGrid
        widgets={dashboard.widgets}
        isEditing={false}
        onLayoutChange={() => {}}
        onEditWidget={() => {}}
        onRemoveWidget={() => {}}
        isPublic
      />
    </PageContainer>
  )
}
