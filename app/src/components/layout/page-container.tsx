import { cn } from '@/lib/utils'

/**
 * The outer shell every authenticated route renders into.
 *
 * Before this existed each page spelled its own geometry, and they drifted:
 * an audit of the 22 sidebar routes found four content widths (none, 672,
 * 768, 1024) with no rule behind which page got which, one page centred while
 * the other 21 were left-anchored, and five different class spellings for the
 * same intent (`p-6`, `max-w-3xl p-6`, `p-6 max-w-3xl`, `p-6 max-w-2xl`,
 * `mx-auto w-full max-w-5xl px-6 pb-16`). Walking Settings -> System Status ->
 * Search moved the text column 672 -> 768 -> centred in three clicks.
 *
 * There are two widths now, and the choice is about content, not taste:
 *
 * - `full`    tables, card grids, and lists, which use the width they are given.
 * - `narrow`  forms, prose, and short read-outs, where a full-bleed line length
 *             is unreadable on a wide display.
 *
 * Page padding is `p-6` in both cases and is not overridable per page: it was
 * the one measurement already consistent across 21 of 22 routes, so it is the
 * baseline worth protecting.
 */
export type PageWidth = 'full' | 'narrow'

const WIDTH_CLASS: Record<PageWidth, string> = {
  full: '',
  narrow: 'max-w-3xl',
}

interface PageContainerProps {
  width?: PageWidth
  className?: string
  children: React.ReactNode
}

export function PageContainer({
  width = 'full',
  className,
  children,
}: PageContainerProps) {
  return <div className={cn('p-6', WIDTH_CLASS[width], className)}>{children}</div>
}
