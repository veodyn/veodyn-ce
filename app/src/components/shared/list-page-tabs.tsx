'use client'

import Link from 'next/link'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * The scope tabs above a library list (All / Mine / Favorites / Archive).
 *
 * These tabs are real routes (`?tab=my`), not client state. TabsTrigger renders
 * a <button>, so Base UI's `render` escape hatch makes the trigger BE the link.
 *
 * `value` is controlled by the URL and there is no `onValueChange`: activating
 * a tab navigates, and the next render reads the value out of the query string.
 */
export interface ListPageTab {
  key: string
  label: string
}

export function ListPageTabs({
  tabs,
  active,
  href,
  label,
}: {
  tabs: readonly ListPageTab[]
  active: string
  /** Where a given tab points. Kept a function so the caller owns its route. */
  href: (key: string) => string
  /** Names the tab list for screen readers, e.g. "Filter dashboards". */
  label: string
}) {
  return (
    <Tabs value={active}>
      <TabsList variant="line" aria-label={label}>
        {tabs.map((t) => (
          <TabsTrigger
            key={t.key}
            value={t.key}
            // Required alongside render={<Link/>}: Base UI assumes a native
            // <button> and warns that an anchor drops button semantics.
            nativeButton={false}
            render={<Link href={href(t.key)} />}
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
