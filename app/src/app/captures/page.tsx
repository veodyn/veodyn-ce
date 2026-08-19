'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Rss } from 'lucide-react'
import { NoData } from '@/components/ui/no-data'
import { PageHeader } from '@/components/layout/page-header'
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { TimeAgo } from '@/components/shared/time-ago'
import { ExpectedIntervalControl } from '@/components/captures/expected-interval-control'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { Slot, hasSlotContributor } from '@/features/slots'
import { cn } from '@/lib/utils'
import { deriveCaptureStatus, captureStatusBasis, CAPTURE_STATUS_META } from '@/lib/capture-status'
import { matchesSearch } from '@/lib/list-filter'
import { useCatalog } from '@/hooks/use-catalog'
import { useCaptures } from '@/hooks/use-captures'
import type { Dataset } from '@/types/catalog'
import type { Capture } from '@/types/capture'
import { PageContainer } from '@/components/layout/page-container'

// Status is conveyed by icon + text + a semantic token, never color alone. The
// word and the icon come from CAPTURE_STATUS_META, shared with the catalog's
// FreshnessBadge, which renders the same three statuses as a tinted pill. Those
// two were spelled out separately and had already disagreed once, with `down`
// reachable here and missing there. The bare form keeps `text`, not `badge`:
// there is no tint behind it, so the status colour is safe on the text itself.
function CaptureStatus({ status }: { status: Capture['status'] }) {
  const { label, Icon, text } = CAPTURE_STATUS_META[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', text)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </span>
  )
}

/**
 * The Metrics affected column, present only when a feature fills it.
 *
 * The point of the board is that a capture being stale for nine days matters
 * because of what is still being computed from it and presented as current.
 * What is computed from it is a KPI, and KPIs are a feature, so this column
 * asks the registry rather than joining datasets to KPIs itself.
 *
 * The whole COLUMN is gated on there being a contributor, not just its cells.
 * A community build has no metrics to name, and a column of "None" down every
 * row would say the captures affect nothing, which is a different claim and a
 * false one. Every other column keeps its layout and its empty state exactly as
 * it was; this is the one that has nothing honest to render on its own.
 */
function metricsColumn(datasetsByCapture: Map<string, Dataset[]>): Column<Capture>[] {
  if (!hasSlotContributor('captures.metrics')) return []
  return [
    {
      key: 'metrics',
      title: 'Metrics affected',
      render: (c) => (
        <Slot id="captures.metrics" props={{ datasets: datasetsByCapture.get(c.id) ?? [] }} fallback={null} />
      ),
    },
  ]
}

function buildColumns(datasetsByCapture: Map<string, Dataset[]>): Column<Capture>[] {
  return [
    {
      key: 'name',
      title: 'Capture',
      sortValue: (c) => c.name,
      render: (c) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{c.name}</div>
          <div className="font-mono text-xs text-muted-foreground">{c.source}</div>
        </div>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      // Derived from cadence and last received, not read off the fixture,
      // except when there is no cadence to derive from. That exception used to
      // be invisible, so a verdict nobody had checked looked exactly like one
      // that had been.
      sortValue: (c) => CAPTURE_STATUS_META[deriveCaptureStatus(c)].label,
      render: (c) => (
        <div className="flex flex-col gap-0.5">
          <CaptureStatus status={deriveCaptureStatus(c)} />
          {captureStatusBasis(c) === 'reported' && (
            <span className="text-xs text-muted-foreground">as reported</span>
          )}
        </div>
      ),
    },
    {
      key: 'lastReceived',
      title: 'Last received',
      sortValue: (c) => c.lastReceivedAt,
      render: (c) => (
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <TimeAgo date={c.lastReceivedAt} />
        </span>
      ),
    },
    {
      key: 'cadence',
      title: 'Cadence',
      sortValue: (c) => c.cadence,
      // A cadence this cannot parse is not a schedule, whatever string the
      // upstream sent. Printing it in the same monospace as a real interval
      // put "not scheduled" next to a Last received of "59 seconds ago" and
      // let it read as a fact about the feed rather than a gap in what is
      // known about it.
      render: (c) => (
        <div className="flex flex-col items-start gap-0.5">
          {captureStatusBasis(c) === 'derived' ? (
            <span className="font-mono text-xs">
              {c.cadence}
              {c.cadenceSource === 'declared' && (
                <span className="ml-1.5 font-sans text-muted-foreground">expected</span>
              )}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              None declared, so age is not checked
            </span>
          )}
          <ExpectedIntervalControl capture={c} />
        </div>
      ),
    },
    {
      key: 'datasets',
      title: 'Datasets',
      // A monitoring row has to lead to the thing it monitors. The count used
      // to be plain text, so a stale feed was a dead end.
      render: (c) => {
        const datasets = datasetsByCapture.get(c.id) ?? []
        if (datasets.length === 0) {
          return <span className="font-mono text-xs tabular-nums text-muted-foreground">0</span>
        }
        return (
          <div className="flex flex-col gap-0.5">
            {datasets.map((d) => (
              <Link
                key={d.id}
                href={`/data/dataset/${d.id}`}
                className="text-xs text-foreground hover:text-primary hover:underline"
              >
                {d.name}
              </Link>
            ))}
          </div>
        )
      },
    },
    ...metricsColumn(datasetsByCapture),
  ]
}

export default function CapturesPage() {
  const { data: captures, isLoading, isError } = useCaptures()
  const { data: datasets } = useCatalog()
  const [search, setSearch] = useState('')

  const datasetsByCapture = new Map<string, Dataset[]>()
  for (const dataset of datasets ?? []) {
    const captureId = dataset.freshness.captureId
    if (!captureId) continue
    const list = datasetsByCapture.get(captureId)
    if (list) list.push(dataset)
    else datasetsByCapture.set(captureId, [dataset])
  }

  const allCaptures = useMemo(() => captures ?? [], [captures])
  const visible = useMemo(
    () =>
      allCaptures.filter((capture) =>
        matchesSearch(search, [
          capture.name,
          capture.source,
          capture.cadence,
          CAPTURE_STATUS_META[deriveCaptureStatus(capture)].label,
        ])
      ),
    [allCaptures, search]
  )

  return (
    <PageContainer>
      <PageHeader
        title="Captures"
        description="Scheduled queries that write into the warehouse, and whether each one delivered on time."
      />
      {isLoading ? (
        <SkeletonCard />
      ) : isError ? (
        // The defect this branch exists for was live on stage: /api/captures
        // answered 404, the error left `captures` undefined, and the page
        // rendered the calm "No captures configured." below. A monitoring page
        // that reports its own outage as "nothing to monitor" is the one
        // failure nobody ever files, because it looks like the truth.
        <NoData
          message="Unable to load captures. The capture service may be unavailable."
          icon={<Rss className="mb-3 h-10 w-10 opacity-50" />}
        />
      ) : (
        <>
          {/* ListToolbar's box is a fixed w-64, and this page had written a
              placeholder describing all four filterable fields, so it was
              truncated mid-word to "Search by feed, source, cadenc". A control
              whose own default text does not fit reads as broken. */}
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            searchLabel="Search captures"
            placeholder="Search captures..."
            count={visible.length}
            noun="capture"
          />
          <div className="rounded-lg border bg-card">
            <ItemsTable
              columns={buildColumns(datasetsByCapture)}
              items={visible}
              rowKey={(c) => c.id}
              emptyMessage={
                allCaptures.length === 0
                  ? 'No captures configured.'
                  : 'No capture matches that search'
              }
            />
          </div>
        </>
      )}
    </PageContainer>
  )
}
