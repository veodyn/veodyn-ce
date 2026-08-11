'use client'

import Link from 'next/link'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * The scope tabs above a library list (All / Mine / Favorites / Archive).
 *
 * /queries and /dashboards each hand-rolled this, in two copies of the same
 * twenty lines, and what those copies reimplemented was `ui/tabs`'s own
 * `variant="line"`: the underline is the identical `after:` pseudo-element
 * trick, down to the opacity-0-to-100 swap on the active item. They measured
 * 32px tall against the primitive's 25px on /users and /settings, so the same
 * rung of the same control looked like two different rungs depending on the
 * route you reached it from.
 *
 * These tabs are real routes (`?tab=my`), not client state, which is why they
 * were hand-rolled in the first place: TabsTrigger renders a <button>. It also
 * accepts Base UI's `render` escape hatch, so the trigger can BE the link, the
 * same way `Button render={<Link/>}` is used across the app. No fork, no
 * duplicate styling.
 *
 * `value` is controlled by the URL and there is deliberately no
 * `onValueChange`: activating a tab navigates, and the next render reads the
 * new value back out of the query string.
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
            // <button> and warns that swapping in an anchor drops button
            // semantics. Here the anchor is the point, so tell it that. The
            // tests passed without this and only the console said otherwise.
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
