'use client'

import { use } from 'react'
import { ConnectorEditForm } from '@/components/connectors/connector-edit-form'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { useConnector, useConnectorTypes } from '@/hooks/use-connectors'
import { PageContainer } from '@/components/layout/page-container'

export default function ConnectorEditPage({ params }: { params: Promise<{ connectorId: string }> }) {
  const { connectorId } = use(params)

  const { data: connector, isLoading, isError } = useConnector(connectorId)
  const { data: types, isLoading: typesLoading, isError: typesError } = useConnectorTypes()

  if (isLoading || typesLoading) {
    return (
      <PageContainer width="narrow">
        <SkeletonCard lines={4} />
      </PageContainer>
    )
  }

  if (isError || typesError) {
    return (
      <PageContainer width="narrow">
        <NoData message="Unable to load this connector. It may have been removed, or the request was refused." />
      </PageContainer>
    )
  }

  if (!connector) {
    return (
      <PageContainer width="narrow">
        <NoData message="Connector not found." />
      </PageContainer>
    )
  }

  const connectorType = types?.find((t) => t.connectorId === connector.connectorId)

  return <ConnectorEditForm key={connector.connectorId} connector={connector} connectorType={connectorType} />
}
