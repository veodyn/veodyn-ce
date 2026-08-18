// Federation orchestrator: maps over the pluggable sources, threads the signal,
// and flattens the results in source order. A failed source is logged and
// dropped so one dead source cannot blank the set; an abort (superseded by a
// newer keystroke) is neither logged nor counted. If nothing survives a real
// failure the call throws, so useFederatedSearch surfaces isError and /search
// renders its error branch instead of a misleading "No results".
//
// assembleSearchSources composes the community sources with whatever the
// installed features contribute; a caller may pass its own list instead.
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
