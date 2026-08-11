'use client'

import { useRouter } from 'next/navigation'
import { OmnisearchInput } from '@/components/home/omnisearch-input'

/** Wires the Home omnisearch box to the /search results page. */
export function HomeOmnisearch() {
  const router = useRouter()
  return (
    <OmnisearchInput
      onSubmit={(query) => {
        const trimmed = query.trim()
        if (!trimmed) return
        router.push(`/search?q=${encodeURIComponent(trimmed)}`)
      }}
    />
  )
}
