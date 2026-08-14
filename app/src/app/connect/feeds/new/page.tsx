'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { PageContainer } from '@/components/layout/page-container'
import { NoData } from '@/components/ui/no-data'
import { FeedForm } from '@/components/published-feeds/feed-form'
import { ADMINISTERED_NOTE } from '@/components/published-feeds/administered-note'
import { useToast } from '@/components/shared/toast-provider'
import { useCreatePublishedFeed } from '@/hooks/use-published-feeds'
import { placeRefusal } from '@/lib/published-feed-refusals'
import { useAuthStore } from '@/stores/auth-store'
import type { PublishedFeedInput } from '@/types/published-feed'

export default function NewFeedPage() {
  const router = useRouter()
  const toast = useToast()
  const createFeed = useCreatePublishedFeed()
  // The server already refuses a non-admin create with a 403, so this is not a
  // gate. It is a form that could only ever be filled in and rejected, which is
  // worse than no form: the reader does the work before finding out.
  const isAdmin = useAuthStore((s) => s.currentUser)?.isAdmin
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const handleSubmit = async (input: PublishedFeedInput) => {
    setError(null)
    setFieldErrors({})
    try {
      const feed = await createFeed.mutateAsync(input)
      router.push(`/connect/feeds/${feed.slug}`)
    } catch (err) {
      // Every value stays on screen: a refused create that silently dropped
      // the mapping the reader just built would send them back to redo it.
      const placed = placeRefusal(err, 'Could not publish this feed.')
      setFieldErrors(placed.fieldErrors)
      setError(placed.formError)
      toast.error(placed.message)
    }
  }

  if (!isAdmin) {
    return (
      <PageContainer width="narrow">
        <PageHeader title="Publish a Feed" />
        <NoData card message={ADMINISTERED_NOTE} />
      </PageContainer>
    )
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Publish a Feed"
        description="Bind a query to a standard feed this instance will serve."
      />
      <FeedForm
        submitLabel="Publish"
        isPending={createFeed.isPending}
        error={error}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/connect/feeds')}
      />
    </PageContainer>
  )
}
