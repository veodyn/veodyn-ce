// /schedules reported "3 schedules" and hid a late one purely because it sat at
// row 26 of a list the backend pages at 25. A screen that filters, counts or
// monitors has to see the whole set before it can say anything true about it.
import { describe, expect, it, vi } from 'vitest'
import { fetchAllPages, FULL_PAGE_SIZE, MAX_PAGES } from '@/services/redash/paging'

function page(results: number[], count: number, pageNumber: number) {
  return { count, page: pageNumber, page_size: FULL_PAGE_SIZE, results }
}

function rows(from: number, howMany: number): number[] {
  return Array.from({ length: howMany }, (_, i) => from + i)
}

describe('fetchAllPages', () => {
  it('returns a single short page without asking for another', async () => {
    const fetchPage = vi.fn(async (p: number) => page(rows(1, 3), 3, p))

    const result = await fetchAllPages(fetchPage)

    expect(result).toEqual({ count: 3, results: [1, 2, 3], truncated: false })
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('keeps going until it has the row the first page left out', async () => {
    const fetchPage = vi.fn(async (p: number) =>
      p === 1 ? page(rows(1, FULL_PAGE_SIZE), FULL_PAGE_SIZE + 1, p) : page([999], FULL_PAGE_SIZE + 1, p)
    )

    const result = await fetchAllPages(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result.results).toHaveLength(FULL_PAGE_SIZE + 1)
    expect(result.results.at(-1)).toBe(999)
    expect(result.truncated).toBe(false)
  })

  it('asks for the page size it means to read', async () => {
    const fetchPage = vi.fn(async (p: number) => page([], 0, p))

    await fetchAllPages(fetchPage)

    expect(fetchPage).toHaveBeenCalledWith(1, FULL_PAGE_SIZE)
  })

  it('stops on a short page even when the count claims there is more', async () => {
    // A backend that over-reports count would otherwise loop to the page cap on
    // every load, turning one screen into twenty requests.
    const fetchPage = vi.fn(async (p: number) => page(rows(1, 2), 9999, p))

    const result = await fetchAllPages(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result.results).toEqual([1, 2])
    // And it reports what it holds, not the backend's claim: a complete read
    // knows its own total, and "9999 schedules" over two rows is just wrong.
    expect(result.count).toBe(2)
  })

  it('keeps reading past an under-reported count rather than stopping early', async () => {
    // A filtered or stale count that is smaller than the truth used to end the
    // read, and every caller then presented the partial list as complete.
    const fetchPage = vi.fn(async (p: number) =>
      p === 1 ? page(rows(1, FULL_PAGE_SIZE), 2, p) : page([999], 2, p)
    )

    const result = await fetchAllPages(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(result.results).toHaveLength(FULL_PAGE_SIZE + 1)
    // The count it reports is at least what it actually holds.
    expect(result.count).toBe(FULL_PAGE_SIZE + 1)
  })

  it('stops on a full last page when the count says that is all there is', async () => {
    // A library that is an exact multiple of the page size. Redash's paginate()
    // aborts 400 when `(page - 1) * page_size + 1 > count` (handlers/base.py),
    // so asking for page 2 of exactly 100 rows does not return an empty page,
    // it throws and takes all 100 rows already read down with it. The Archive
    // tab showed nothing at all on an instance with exactly 100 archived
    // dashboards.
    const fetchPage = vi.fn(async (p: number) => {
      if (p > 1) throw new Error('Page is out of range')
      return page(rows(1, FULL_PAGE_SIZE), FULL_PAGE_SIZE, p)
    })

    const result = await fetchAllPages(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(result.results).toHaveLength(FULL_PAGE_SIZE)
    expect(result.count).toBe(FULL_PAGE_SIZE)
    expect(result.truncated).toBe(false)
  })

  it('gives up at the page cap and says the answer is partial', async () => {
    const fetchPage = vi.fn(async (p: number) =>
      page(rows(1, FULL_PAGE_SIZE), FULL_PAGE_SIZE * 1000, p)
    )

    const result = await fetchAllPages(fetchPage)

    expect(fetchPage).toHaveBeenCalledTimes(MAX_PAGES)
    expect(result.truncated).toBe(true)
  })

  it('survives a backend that omits the count', async () => {
    const fetchPage = vi.fn(async (p: number) => ({
      page: p,
      page_size: FULL_PAGE_SIZE,
      results: [1, 2],
    }))

    const result = await fetchAllPages(fetchPage as never)

    expect(result).toEqual({ count: 2, results: [1, 2], truncated: false })
  })
})
