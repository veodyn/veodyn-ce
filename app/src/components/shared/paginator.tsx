'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/shared/icon-button'

interface PaginatorProps {
  page: number
  totalPages: number
  onChange: (page: number) => void
  className?: string
}

export function Paginator({ page, totalPages, onChange, className }: PaginatorProps) {
  if (totalPages <= 1) return null

  return (
    <div className={cn('flex items-center justify-center gap-2 mt-4', className)}>
      <IconButton
        tooltip="Previous page"
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronLeft className="h-4 w-4" />
      </IconButton>
      {/* Live, because paging replaces the rows without moving focus: the
          button under the pointer stays put and everything it controls
          changes, which a screen reader would otherwise not mention at all. */}
      <span aria-live="polite" className="text-sm text-muted-foreground px-2">
        Page {page} of {totalPages}
      </span>
      <IconButton
        tooltip="Next page"
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <ChevronRight className="h-4 w-4" />
      </IconButton>
    </div>
  )
}
