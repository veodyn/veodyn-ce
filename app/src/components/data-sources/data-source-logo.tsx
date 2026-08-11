'use client'

import { useState } from 'react'
import { Database } from 'lucide-react'

/**
 * Data-source type logo, vendored under public/db-logos/{type}.png. These
 * used to be proxied from the Redash backend, which only had them because
 * webpack's file-loader copied them out of the fork's client during build.
 * Now they are served by Next directly from public/, so no route handler is
 * needed: a file in public/ needs no code to be served, and Next's static
 * file serving resolves the path itself rather than a hand-rolled regex.
 * Falls back to a generic database icon when there is no logo for the type.
 */
export function DataSourceLogo({
  type,
  className,
  fallbackClassName,
}: {
  type: string
  className?: string
  fallbackClassName?: string
}) {
  const [failed, setFailed] = useState(false)

  if (failed || !type) {
    return <Database className={fallbackClassName ?? className} />
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/db-logos/${encodeURIComponent(type)}.png`}
      alt={type}
      className={className}
      onError={() => setFailed(true)}
    />
  )
}
