'use client'

// One "the things this person owns" section: a heading over a table, with its
// own loading, error and empty states.
//
// Extracted from profile-content.tsx when the KPI half of that page moved
// behind the profile.section slot. The two halves have to look identical and
// they no longer live in the same file, so the shape they share is a component
// rather than a convention. It stays here, in the community tree, for the same
// reason ItemsTable does: a contributed section renders inside a community
// page and has to match the sections beside it.
//
// Each section reads its own query and renders its own states, so one backend
// that is down does not blank the sections that are up.
import { ItemsTable, type Column } from '@/components/shared/items-table'
import { NoData } from '@/components/ui/no-data'
import { SkeletonCard } from '@/components/ui/skeleton-card'
import { MICRO_LABEL } from '@/lib/section-heading'

export function OwnedSection<T>({
  title,
  isLoading,
  isError,
  items,
  columns,
  rowKey,
  emptyMessage,
  errorMessage,
}: {
  title: string
  isLoading: boolean
  isError: boolean
  items: T[]
  columns: Column<T>[]
  rowKey: (item: T) => string | number
  emptyMessage: string
  errorMessage: string
}) {
  // No truncation affordance here on purpose: useMyQueries and useMyDashboards
  // page through the whole owned set, so what this renders is all of it. An
  // earlier version showed "showing 25 of N, view all", which was worse than
  // useless: the link landed on the All tab, whose My tab fetched the same
  // single page, so it could not reveal the rows it admitted to hiding.
  return (
    <section>
      <h3 className={`mb-2 ${MICRO_LABEL}`}>{title}</h3>
      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <SkeletonCard lines={2} />
        ) : isError ? (
          <NoData message={errorMessage} />
        ) : (
          <ItemsTable columns={columns} items={items} rowKey={rowKey} emptyMessage={emptyMessage} />
        )}
      </div>
    </section>
  )
}
