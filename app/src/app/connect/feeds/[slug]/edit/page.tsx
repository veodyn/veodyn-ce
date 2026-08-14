'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/layout/page-header'
import { PageContainer } from '@/components/layout/page-container'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { FeedForm } from '@/components/published-feeds/feed-form'
import { ADMINISTERED_NOTE } from '@/components/published-feeds/administered-note'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useToast } from '@/components/shared/toast-provider'
import {
  useAttempts,
  usePublishedFeed,
  usePublishNow,
  useUpdatePublishedFeed,
} from '@/hooks/use-published-feeds'
import { placeRefusal } from '@/lib/published-feed-refusals'
import { useAuthStore } from '@/stores/auth-store'
import type { PublishedFeedInput } from '@/types/published-feed'

export default function EditFeedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const router = useRouter()
  const toast = useToast()
  // The server refuses a non-admin update with a 403, so this is not a gate on
  // anything. It is a form that could only ever be filled in and rejected.
  const isAdmin = useAuthStore((s) => s.currentUser)?.isAdmin

  const { data: feed, isLoading, isError } = usePublishedFeed(slug)
  const { data: attempts, isLoading: attemptsLoading, isError: attemptsError } = useAttempts(slug)
  const update = useUpdatePublishedFeed()
  const publish = usePublishNow()

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Held between the submit that triggers the confirm and the confirm itself,
  // so confirming does not require the reader to have kept the form's own
  // state around, and so the mutation sends exactly what was on screen when
  // Save was pressed.
  const [pendingInput, setPendingInput] = useState<PublishedFeedInput | null>(null)
  const [confirmingGoDark, setConfirmingGoDark] = useState(false)

  if (!isAdmin) {
    return (
      <PageContainer width="narrow">
        <PageHeader title={`Edit ${slug}`} />
        <NoData card message={ADMINISTERED_NOTE} />
      </PageContainer>
    )
  }

  if (isLoading || attemptsLoading) {
    return (
      <PageContainer width="narrow">
        <SkeletonCard lines={4} />
      </PageContainer>
    )
  }

  // A failed read is not a missing feed: saying "not found" for a backend that
  // refused the request sends the reader looking for a deletion that never
  // happened.
  if (isError || attemptsError) {
    return (
      <PageContainer width="narrow">
        <NoData message="Unable to load this feed. It may have been deleted, or the request was refused." />
      </PageContainer>
    )
  }

  if (!feed) {
    return (
      <PageContainer width="narrow">
        <NoData message="Feed not found." />
      </PageContainer>
    )
  }

  const isLive = (attempts ?? []).some((a) => a.isCurrent)

  const save = async (input: PublishedFeedInput, opts: { republish: boolean }) => {
    setError(null)
    setFieldErrors({})
    try {
      await update.mutateAsync({ slug, input })
      // Fired the moment the update lands, not left for the next worker
      // cycle: that is the one request that keeps the dark window as short
      // as this UI can make it.
      if (opts.republish) await publish.mutateAsync(slug)
      router.push(`/connect/feeds/${slug}`)
    } catch (err) {
      // Every value stays on screen: a refused update that silently dropped
      // the mapping the reader just built would send them back to redo it.
      // `update_feed` runs the same checks `create_feed` does and answers with
      // the same refusals, so they are placed the same way rather than all
      // being swept into the page-level banner.
      setConfirmingGoDark(false)
      const placed = placeRefusal(err, 'Could not save this feed.')
      setFieldErrors(placed.fieldErrors)
      setError(placed.formError)
      toast.error(placed.message)
    }
  }

  const handleSubmit = (input: PublishedFeedInput) => {
    if (isLive) {
      setPendingInput(input)
      setConfirmingGoDark(true)
      return
    }
    void save(input, { republish: false })
  }

  const handleConfirmGoDark = () => {
    if (!pendingInput) return
    void save(pendingInput, { republish: true })
  }

  const isPending = update.isPending || publish.isPending

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={`Edit ${slug}`}
        description="A feed's address cannot be renamed; publish a new one to change it."
      />
      <FeedForm
        initial={feed}
        slugLocked
        // The label is the only place an admin learns that saving a serving
        // feed also fires an attempt. On a feed that is already dark there is
        // nothing to republish, and promising one would be a second lie.
        submitLabel={isLive ? 'Save and republish' : 'Save'}
        isPending={isPending}
        error={error}
        fieldErrors={fieldErrors}
        onSubmit={handleSubmit}
        onCancel={() => router.push(`/connect/feeds/${slug}`)}
      />

      <ConfirmDialog
        open={confirmingGoDark}
        onOpenChange={setConfirmingGoDark}
        title="Take this feed off the air?"
        description={`Saving takes ${slug} off the air until a new publish attempt succeeds. Consumers of the address get nothing in the meantime.`}
        confirmLabel="Save anyway"
        destructive
        isPending={isPending}
        onConfirm={handleConfirmGoDark}
      />
    </PageContainer>
  )
}
