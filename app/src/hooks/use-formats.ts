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
import type { DisplayPatterns } from '@/lib/date-pattern'
import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  formatCalendarDate,
  formatDate,
  formatDateTime,
} from '@/lib/format-datetime'

// Extends DisplayPatterns rather than restating its two fields, so a chart that
// asks for the configured patterns can be handed this value directly and the
// two definitions of "the operator's date and time format" cannot drift apart.
export interface Formats extends DisplayPatterns {
  /** The date alone, in the configured pattern. */
  date: (value: unknown) => string
  /** Date and time, in the two configured patterns. */
  dateTime: (value: unknown) => string
  /**
   * A calendar day rather than an instant, in the configured pattern. Use for
   * coverage bounds and similar: `date` would shift them across midnight.
   */
  calendarDate: (value: unknown) => string
}

export function useFormats(): Formats {
  const { data: orgSettings } = useOrgSettings()
  const clientConfig = useAuthStore((s) => s.clientConfig)

  return useMemo(() => {
    const dateFormat = orgSettings?.date_format || clientConfig.dateFormat || DEFAULT_DATE_FORMAT
    const timeFormat = orgSettings?.time_format || DEFAULT_TIME_FORMAT
    return {
      dateFormat,
      timeFormat,
      date: (value: unknown) => formatDate(value, dateFormat),
      dateTime: (value: unknown) => formatDateTime(value, dateFormat, timeFormat),
      calendarDate: (value: unknown) => formatCalendarDate(value, dateFormat),
    }
  }, [orgSettings?.date_format, orgSettings?.time_format, clientConfig.dateFormat])
}
