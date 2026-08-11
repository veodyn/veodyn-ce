// Federation orchestrator. Maps over the pluggable sources, threads the
// signal, and flattens the results in source order. allSettled keeps one dead
// source from blanking the whole result set: a rejected source is logged
// through the error registry and dropped, so the palette and /search stay
// resilient for a partial failure. An aborted rejection (the search was
// superseded by a newer keystroke) is neither logged nor counted as a
// failure, since aborting is normal, expected traffic. If every source fails
// for a real reason and nothing survives, the whole call throws so
// useFederatedSearch surfaces isError and /search renders its error branch
// instead of a misleading "No results".
//
// Which sources those are is not decided here and is no longer a fixed array:
// assembleSearchSources composes the community sources with whatever the
// installed features contribute. A caller may still pass its own list, which
// is what every test in this file does.
import { assembleSearchSources } from '@/features/search-sources'
import { AppError, ErrorIds } from '@/lib/errorIds'
import type { SearchResultItem, SearchSource } from './types'

function isAbortRejection(reason: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return true
  return (
    typeof reason === 'object' &&
    reason !== null &&
    'name' in reason &&
    (reason as { name?: unknown }).name === 'AbortError'
  )
}

export async function federatedSearch(
  query: string,
  ctx: { signal?: AbortSignal; sources?: SearchSource[]; tag?: string } = {}
): Promise<SearchResultItem[]> {
  const sources = ctx.sources ?? (await assembleSearchSources())
  const settled = await Promise.allSettled(
    sources.map((source) => source.search(query, { signal: ctx.signal, tag: ctx.tag }))
  )

  const items: SearchResultItem[] = []
  let failureCount = 0
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      items.push(...result.value)
      return
    }
    if (isAbortRejection(result.reason, ctx.signal)) {
      return
    }
    const source = sources[index]
    const error = new AppError(
      ErrorIds.SEARCH_SOURCE_FAILED,
      'A search source failed and was skipped',
      { source: source.type, reason: String(result.reason) }
    )
    console.error(error.toLogLine())
    failureCount += 1
  })

  if (items.length === 0 && failureCount > 0) {
    throw new AppError(ErrorIds.SEARCH_SOURCE_FAILED, 'All search sources failed', {
      query,
      failureCount,
    })
  }

  return items
}
