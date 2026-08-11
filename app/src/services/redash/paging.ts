// Reading a whole Redash list, not just its first page.
//
// The list endpoints default to 25 rows. A page is the right unit for a screen
// the user scrolls, but wrong for a screen that filters, counts, or monitors:
// /schedules reported "3 schedules" and hid a late one purely because it sat at
// row 26, and /favorites truncated the same way. Those screens need the whole
// set before they can say anything true about it.

import type { RedashPaginatedResponse } from '@/services/redash/types'

/** Large enough that most instances finish in one request, inside Redash's cap. */
export const FULL_PAGE_SIZE = 100

/**
 * Bounded, because an unbounded loop against a paginating backend is how one
 * mis-parsed count turns a page load into a denial of service against the
 * instance. 20 pages of 100 is far past any real library.
 */
export const MAX_PAGES = 20

export interface FullList<T> {
  count: number
  results: T[]
  /** True when the page cap was reached before the backend ran out of rows. */
  truncated: boolean
}

export async function fetchAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<RedashPaginatedResponse<T>>
): Promise<FullList<T>> {
  const results: T[] = []
  let count = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await fetchPage(page, FULL_PAGE_SIZE)
    results.push(...body.results)
    count = typeof body.count === 'number' ? body.count : results.length
    // A short page is the only end condition. The reported count is not
    // trusted to stop the loop: a backend that under-reports it (a filtered
    // count, a stale cache) would stop the read early and hand back a partial
    // list that every caller then presents as the complete one. A full page
    // means keep going, whatever the count says.
    if (body.results.length < FULL_PAGE_SIZE) {
      // A short page proves the read is complete, so what it holds IS the
      // total. The reported count is not: an over-reporting backend would have
      // the screen say "9,999 schedules" above two rows.
      return { count: results.length, results, truncated: false }
    }

    // The one case where a full page is still the end: the count says there is
    // nothing past what we hold. Redash's paginate() aborts 400 when
    // `(page - 1) * page_size + 1 > count` (handlers/base.py:156), so with a
    // library that is an exact multiple of FULL_PAGE_SIZE the next request is
    // not merely wasted, it is a guaranteed 400 that throws away every row
    // already read and leaves the screen empty. Exactly 100 archived dashboards
    // did this.
    //
    // Equality, not `>=`, and that distinction is the whole point. An
    // under-reporting backend has `count < results.length` (the count says 2,
    // the full page handed over 100) and must still be read past, which is the
    // rule above and the case paging.test.ts pins. Only an exact agreement
    // between a full page and the reported total means "this is all of it".
    if (count > 0 && results.length === count) {
      return { count: results.length, results, truncated: false }
    }
  }

  // The cap was hit with a full page still coming: there is more than this.
  return { count: Math.max(count, results.length), results, truncated: true }
}
