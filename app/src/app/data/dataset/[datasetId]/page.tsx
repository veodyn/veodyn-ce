'use client'

import { use } from 'react'
import Link from 'next/link'
import { Play } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { FreshnessBadge } from '@/components/catalog/freshness-badge'
import { CopySchemaJson } from '@/components/catalog/copy-schema-json'
import { SchemaTable } from '@/components/catalog/schema-table'
import { TagsControl } from '@/components/shared/tags-control'
import { Slot } from '@/features/slots'
import { useDataset } from '@/hooks/use-catalog'
import { useFormats } from '@/hooks/use-formats'
import { useObjectTags, useTagBackendAvailable } from '@/hooks/use-object-tags'
import { useTagVocabulary } from '@/hooks/use-tag-vocabulary'
import { useAuthStore } from '@/stores/auth-store'
import { PageContainer } from '@/components/layout/page-container'
import { SECTION_HEADING } from '@/lib/section-heading'

/**
 * Coverage used to slice the ISO string, on the reasoning that an ISO date is
 * unambiguous. It is, but it made this the one page that ignored Settings >
 * Formats: a reader who had chosen MM/DD/YY saw it everywhere except here.
 *
 * Its own component because the page suspends on `use(params)`, and hanging
 * another subscribing hook off that component upset the hook record on the
 * replay React does after the promise resolves.
 */
function CoverageRange({ start, end }: { start: string; end: string }) {
  const formats = useFormats()
  return (
    <div className="font-mono tabular-nums">
      {`${formats.calendarDate(start)} to ${formats.calendarDate(end)}`}
    </div>
  )
}

export default function DatasetDetailPage({ params }: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = use(params)
  const { data: dataset, isLoading, isError } = useDataset(datasetId)
  const currentUser = useAuthStore((s) => s.currentUser)
  // Always an array and never rejecting, so the vocabulary being down degrades
  // the add input to free text rather than taking tagging out.
  const tagSuggestions = useTagVocabulary().data
  const tagBackendAvailable = useTagBackendAvailable()
  const { saveTags } = useObjectTags('dataset', datasetId)

  if (isLoading) {
    return (
      <PageContainer width="narrow">
        <SkeletonCard />
      </PageContainer>
    )
  }

  if (isError) {
    return (
      <PageContainer width="narrow">
        <NoData message="Unable to load this dataset. The catalog service may be unavailable." />
      </PageContainer>
    )
  }

  if (!dataset) {
    return (
      <PageContainer width="narrow">
        <NoData message="Dataset not found" />
      </PageContainer>
    )
  }

  const queryHref = dataset.sampleQueryId != null ? `/queries/${dataset.sampleQueryId}` : '/queries/new'
  // Any signed-in member of the org. A dataset has no owner to check against
  // (its id is a warehouse table name, not a row someone created), and curating
  // shared tables is a wiki-like surface rather than an owned one.
  const canEditTags = tagBackendAvailable && currentUser != null

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={dataset.name}
        description={dataset.description}
        action={
          <div className="flex items-center gap-2">
            {/* Where a feature adds an action ABOUT this dataset. Empty in a
                community build, which is the intended state, same rule as
                dataset.records below. */}
            <Slot id="dataset.headerActions" props={{ dataset }} fallback={null} />
            <Button render={<Link href={queryHref} />}>
              <Play className="h-4 w-4" />
              Query this dataset
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            {/* Captured datasets only. "Stale" describes a feed that stopped
                arriving, and a dataset nobody feeds has not stopped: a
                contributed one is complete when its author says it is. An
                empty contributed dataset is the case that makes this
                concrete, because it has no coverage end and so reads as
                stale on the day it is declared. */}
            {dataset.origin === 'capture' && <FreshnessBadge freshness={dataset.freshness} />}
            {dataset.domain != null && (
              <Link
                href={`/data/${dataset.domain}`}
                className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                Domain: {dataset.domain}
              </Link>
            )}
            {/* In the same metadata row as freshness and the domain link, which
                is where this card already puts everything that describes the
                dataset rather than measuring it. */}
            <TagsControl
              tags={dataset.tags}
              editable={canEditTags}
              onChange={saveTags}
              suggestions={tagSuggestions}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm text-muted-foreground">Coverage</div>
            <CoverageRange start={dataset.coverage.start} end={dataset.coverage.end} />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Rows</div>
            <div className="font-mono tabular-nums">{dataset.rowCount.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Sources</div>
            <ul className="list-inside list-disc">
              {dataset.sources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-1">
          <h2 className={SECTION_HEADING}>Schema</h2>
          <CopySchemaJson schema={dataset.schema} />
        </div>
        <SchemaTable schema={dataset.schema} />
      </div>

      {/* Where the enterprise record editor mounts. Empty in a community build,
          which is the intended state and not a missing feature: writing to a
          dataset is enterprise, and a build without that pack shows a catalog
          entry with nothing to type into. Same rule as feedHealth.metrics. */}
      <Slot id="dataset.records" props={{ dataset }} fallback={null} />
    </PageContainer>
  )
}
