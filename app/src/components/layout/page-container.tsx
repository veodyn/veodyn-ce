import { cn } from '@/lib/utils'

/**
 * The outer shell every authenticated route renders into. Two widths, chosen by
 * content:
 *
 * - `full`    tables, card grids, and lists, which use the width they are given.
 * - `narrow`  forms, prose, and short read-outs, where a full-bleed line length
 *             is unreadable on a wide display.
 *
 * Page padding is `p-6` in both cases and is not overridable per page.
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
