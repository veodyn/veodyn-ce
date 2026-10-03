'use client'

// One reader for the display formats an operator picks in Settings > Formats.
//
// Two sources carry the same values. The org settings endpoint is what the
// Settings screen writes, and Redash's client_config echoes them onto the
// session. Org settings win, because they are what a save just changed; the
// session copy is the fallback that needs no extra request, and the built-in
// defaults are the floor.

import { useMemo } from 'react'
import { useOrgSettings } from '@/hooks/use-org-settings'
import { useAuthStore } from '@/stores/auth-store'
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT } from '@/lib/format-datetime'
import { formatsFor, type Formats } from '@/lib/viz-formats'

export type { Formats }

export function useFormats(opts: { enabled?: boolean } = {}): Formats {
  const { data: orgSettings } = useOrgSettings(opts)
  const clientConfig = useAuthStore((s) => s.clientConfig)

  return useMemo(() => {
    const dateFormat = orgSettings?.date_format || clientConfig.dateFormat || DEFAULT_DATE_FORMAT
    const timeFormat = orgSettings?.time_format || DEFAULT_TIME_FORMAT
    return formatsFor(dateFormat, timeFormat)
  }, [orgSettings?.date_format, orgSettings?.time_format, clientConfig.dateFormat])
}
