import { SearchPageClient } from '@/components/search/search-page-client'
import { firstTag, normalizeTab } from '@/lib/search/url'

/** A repeated query param (/search?q=bus&q=rail) arrives as a string array. */
function firstValue(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[]; tag?: string | string[] }>
}) {
  const { q, type, tag } = await searchParams

  return (
    <SearchPageClient
      initialQuery={firstValue(q)}
      initialTab={normalizeTab(type)}
      initialTag={firstTag(tag)}
    />
  )
}
