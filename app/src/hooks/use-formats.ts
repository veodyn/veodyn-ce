'use client'

import { useMemo } from 'react'
import { useOrgSettings } from '@/hooks/use-org-settings'
import { useAuthStore } from '@/stores/auth-store'
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from '@veodyn/viz/lib/format-datetime'
import { formatsFor, type Formats } from '@veodyn/viz/lib/viz-formats'

export type { Formats }

function sessionTimeFormat(dateFormat: string, dateTimeFormat: string): string {
  const prefix = `${dateFormat} `
  return dateFormat && dateTimeFormat.startsWith(prefix) ? dateTimeFormat.slice(prefix.length) : ''
}

export function useFormats(opts: { enabled?: boolean } = {}): Formats {
  const isAdmin = useAuthStore((s) => s.currentUser?.isAdmin === true)
  const { data: orgSettings } = useOrgSettings({ enabled: isAdmin && (opts.enabled ?? true) })
  const clientConfig = useAuthStore((s) => s.clientConfig)

  return useMemo(() => {
    const dateFormat = orgSettings?.date_format || clientConfig.dateFormat || DEFAULT_DATE_FORMAT
    const timeFormat =
      orgSettings?.time_format ||
      sessionTimeFormat(clientConfig.dateFormat, clientConfig.dateTimeFormat) ||
      DEFAULT_TIME_FORMAT
    return formatsFor(dateFormat, timeFormat)
  }, [orgSettings?.date_format, orgSettings?.time_format, clientConfig.dateFormat, clientConfig.dateTimeFormat])
}
