'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const REFRESH_OPTIONS = [
  { label: 'Never', value: 0 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '10 minutes', value: 600 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
  { label: '12 hours', value: 43200 },
  { label: '24 hours', value: 86400 },
]

interface RefreshRatePickerProps {
  onRefresh: () => void
}

export function RefreshRatePicker({ onRefresh }: RefreshRatePickerProps) {
  const [interval, setIntervalValue] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const active = interval > 0

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (interval > 0) {
      timerRef.current = setInterval(onRefresh, interval * 1000)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [interval, onRefresh])

  const currentLabel = REFRESH_OPTIONS.find((o) => o.value === interval)?.label || 'Never'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className={cn(active && 'border-primary text-primary')} />}
      >
        <RefreshCw className={cn('h-4 w-4', active && 'animate-spin')} />
        {currentLabel}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {REFRESH_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setIntervalValue(opt.value)}
            className={cn(interval === opt.value && 'font-medium text-primary')}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
