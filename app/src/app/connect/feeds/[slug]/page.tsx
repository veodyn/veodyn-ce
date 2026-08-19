'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/layout/page-header'
import { PageContainer } from '@/components/layout/page-container'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { Button, buttonVariants } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useToast } from '@/components/shared/toast-provider'
import { ServingStatus } from '@/components/published-feeds/serving-status'
import { AttemptHistory } from '@/components/published-feeds/attempt-history'
import { BindingSummary } from '@/components/published-feeds/binding-summary'
import { FeedAddress } from '@/components/published-feeds/feed-address'
import { AdministeredNote } from '@/components/published-feeds/administered-note'
import { Slot } from '@/features/slots'
import {
  useAttempts,
  useDeletePublishedFeed,
  usePublishedFeed,
  usePublishNow,
  useQueryResultColumns,
} from '@/hooks/use-published-feeds'
import { useAuthStore } from '@/stores/auth-store'
import { SECTION_HEADING } from '@/lib/section-heading'

/**
 * Why the publish control is being withheld, or null when it can be offered.
 *
 * Fails closed. The engine records a `failed` attempt for a result that is not
 * newer than the one already serving, so a button offered in any state where an
 * attempt cannot succeed manufactures a failure rather than reporting one.
 */
function publishHeldBack(
  lookup: { isPending: boolean; isError: boolean; resultId: number | null | undefined },
  servingResultId: number | undefined
): string | null {
  if (lookup.isPending) {
    return 'Checking whether this query has a result newer than the one being served.'
  }
  if (lookup.isError) {
    return 'This query could not be read, so there is no telling whether publishing would serve anything new.'
  }
  if (lookup.resultId == null) {
    return 'This query has no cached result, so there is nothing to publish.'
  }
  if (servingResultId != null && lookup.resultId <= servingResultId) {
    return 'This query has produced nothing new since the last publish.'
  }
  return null
}

export default function FeedDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const toast = useToast()
  const isAdmin = useAuthStore((s) => s.currentUser)?.isAdmin
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // No router redirect after a delete: the page stays put and swaps to the
  // deleted state below.
  const [deleted, setDeleted] = useState(false)

  const { data: feed, isLoading, isError } = usePublishedFeed(slug)
  const { data: attempts, isLoading: attemptsLoading, isError: attemptsError } = useAttempts(slug)
  const resultColumns = useQueryResultColumns(feed?.queryId)
  const publishNow = usePublishNow()
  const deleteFeed = useDeletePublishedFeed()

  if (isLoading || attemptsLoading) {
    return (
      <PageContainer width="narrow">
        <SkeletonCard lines={4} />
      </PageContainer>
    )
  }

  // A failed read is not a missing feed: "not found" for a refused request
  // sends the reader looking for a deletion that never happened.
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

  if (deleted) {
    return (
      <PageContainer width="narrow">
        <NoData
          card
          message={
            <>
              {slug} is no longer published.{' '}
              <Link href="/connect/feeds" className="text-primary hover:underline">
                Back to published feeds
              </Link>
            </>
          }
        />
      </PageContainer>
    )
  }

  const list = attempts ?? []
  // Newest by timestamp, not by array position: nothing in the contract
  // promises the newest-first order the store and fixtures happen to return.
  const newest = [...list].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0]

  // The served artifact, if any: at most one attempt carries isCurrent.
  const currentAttempt = list.find((a) => a.isCurrent)
  const heldBack = publishHeldBack(
    {
      isPending: resultColumns.isPending,
      isError: resultColumns.isError,
      resultId: resultColumns.data?.resultId,
    },
    currentAttempt?.queryResultId
  )

  const handlePublish = () => {
    publishNow.mutate(slug, {
      onSuccess: () => toast.success(`Recorded a new publish attempt for ${slug}.`),
      onError: () => toast.error(`Could not publish ${slug}.`),
    })
  }

  const handleDelete = () => {
    deleteFeed.mutate(slug, {
      onSuccess: () => {
        setConfirmingDelete(false)
        setDeleted(true)
        toast.success(`Unpublished ${slug}.`)
      },
      onError: () => {
        setConfirmingDelete(false)
        toast.error(`Could not unpublish ${slug}.`)
      },
    })
  }

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={slug}
        description={`${feed.standard} ${feed.version} · ${feed.entity}`}
        action={<ServingStatus attempt={newest} />}
      />

      <div className="space-y-4">
        <FeedAddress feed={feed} />
        <BindingSummary feed={feed} />
        {/* Automatic publishing, which a community build has no worker for. */}
        <Slot id="publishedFeed.schedule" props={{ slug }} fallback={null} />
      </div>

      <div className="mt-6 space-y-3">
        <h2 className={SECTION_HEADING}>Publish history</h2>
        <AttemptHistory attempts={list} slug={slug} />
      </div>

      {isAdmin ? (
        <div className="mt-6 flex items-center gap-2">
          {heldBack ? (
            <p className="text-sm text-muted-foreground">{heldBack}</p>
          ) : (
            <Button onClick={handlePublish} disabled={publishNow.isPending}>
              {publishNow.isPending ? 'Publishing…' : 'Publish now'}
            </Button>
          )}
          <Link href={`/connect/feeds/${slug}/edit`} className={buttonVariants({ variant: 'outline' })}>
            Edit
          </Link>
          <Button variant="destructive" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        </div>
      ) : (
        <div className="mt-6">
          <AdministeredNote />
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete "${slug}"?`}
        description={`Consumers of ${slug} start getting nothing at this address. A deleted slug is indistinguishable from one that never existed, and this cannot be undone.`}
        isPending={deleteFeed.isPending}
        onConfirm={handleDelete}
      />
    </PageContainer>
  )
}
