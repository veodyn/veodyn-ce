'use client'

import { Loader2 } from 'lucide-react'

export function QueryExecutionStatus() {
  return (
    <div className="flex items-center justify-center gap-3 py-12">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">Running query...</span>
    </div>
  )
}
