'use client'

import { use } from 'react'
import { DestinationEditForm } from '@/components/destinations/destination-edit-form'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { useDestination, useDestinationTypes } from '@/hooks/use-destinations'
import { PageContainer } from '@/components/layout/page-container'


export default function DestinationEditPage({ params }: { params: Promise<{ destinationId: string }> }) {
  const { destinationId } = use(params)
  const parsed = Number.parseInt(destinationId, 10)
  const id = Number.isNaN(parsed) ? undefined : parsed

  // Read the one destination, not the list. Redash serialises `options` only
  // for this endpoint, so a form seeded from the list showed every config
  // field blank and a save wrote those blanks over the stored configuration.
  const { data: dest, isLoading, isError } = useDestination(id)
  // The schema is what turns stored options into labelled, required-marked
  // fields. Without it the form renders no config inputs at all and its
  // required-field check passes vacuously, so it is part of loading, not an
  // extra that can arrive late.
  const { data: types, isLoading: typesLoading, isError: typesError } = useDestinationTypes()

  if (isLoading || typesLoading) {
    return (
      <PageContainer width="narrow">
        <SkeletonCard lines={4} />
      </PageContainer>
    )
  }

  // A failed read is not a missing destination: saying "not found" for a
  // backend that refused the request sends the reader looking for a deletion
  // that never happened.
  if (isError || typesError) {
    return (
      <PageContainer width="narrow">
        <NoData message="Unable to load this destination. It may have been deleted, or the request was refused." />
      </PageContainer>
    )
  }

  if (!dest) {
    return (
      <PageContainer width="narrow">
        <NoData message="Destination not found." />
      </PageContainer>
    )
  }

  const typeSchema = types?.find((t) => t.type === dest.type)

  // Keyed by id: the form seeds its own state from this destination, so it has
  // to mount once the real one is here rather than reuse state seeded from the
  // placeholder that was on screen while the read was in flight.
  return <DestinationEditForm key={dest.id} destination={dest} typeSchema={typeSchema} />
}
