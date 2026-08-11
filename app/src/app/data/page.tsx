'use client'

import { useMemo, useState } from 'react'
import { Database } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { ListToolbar } from '@/components/shared/list-toolbar'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { DatasetCard } from '@/components/catalog/dataset-card'
import { useCatalog } from '@/hooks/use-catalog'
import { useConfig } from '@/components/config/config-provider'
import { PageContainer } from '@/components/layout/page-container'

export default function DataCatalogPage() {
  const { domains } = useConfig()
  const { data: datasets, isLoading, isError } = useCatalog()
  const [q, setQ] = useState('')
  const [domain, setDomain] = useState<string>('all')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (datasets ?? []).filter(
      (d) =>
        (domain === 'all' || d.domain === domain) &&
        (!needle ||
          d.name.toLowerCase().includes(needle) ||
          d.description.toLowerCase().includes(needle) ||
          // Tags too. Typing a tag here used to return "0 datasets" even for
          // one saved on a dataset a moment earlier, and even for the
          // established tags the picker reports as being on sixteen objects.
          // Case-insensitive on purpose, unlike the exact `?tag=` facet: that
          // one is an identifier Redash matches case-sensitively, this is a
          // search box.
          d.tags.some((tag) => tag.toLowerCase().includes(needle)))
    )
  }, [datasets, q, domain])

  return (
    <PageContainer>
      <PageHeader title="Data Catalog" description="Browse the datasets powering this instance." />
      {/* The shared toolbar, not a local one: this page's search was max-w-sm
          (384px) against the shared w-64, and it was the only list with no
          result count at all. The domain Select goes in the filters slot, where
          the scope tabs sit on /queries and /dashboards. */}
      <ListToolbar
        search={q}
        onSearchChange={setQ}
        searchLabel="Search datasets"
        placeholder="Search datasets..."
        count={filtered.length}
        noun="dataset"
        filters={
          domains.length > 0 ? (
            <Select value={domain} onValueChange={(v) => v != null && setDomain(v)}>
              <SelectTrigger className="w-48" aria-label="Filter by domain">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All domains</SelectItem>
                {domains.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : undefined
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : isError ? (
        <NoData
          message="Unable to load the catalog. The catalog service may be unavailable."
          icon={<Database className="h-8 w-8" />}
        />
      ) : filtered.length === 0 ? (
        <NoData
          icon={<Database className="h-8 w-8" />}
          message={
            q.trim() || domain !== 'all'
              ? 'No datasets match those filters.'
              : 'No datasets yet. They appear here once a data source has been queried.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((d) => (
            <DatasetCard key={d.id} dataset={d} />
          ))}
        </div>
      )}
    </PageContainer>
  )
}
