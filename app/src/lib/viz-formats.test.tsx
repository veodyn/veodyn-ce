import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, formatDate, formatDateTime } from '@/lib/format-datetime'
import { DEFAULT_VIZ_FORMATS, formatsFor, useVizFormats, VizFormatsProvider } from './viz-formats'

const INSTANT = '2026-01-02T15:04:00Z'

describe('visualization formats', () => {
  it('builds formatters from a date and a time pattern', () => {
    const formats = formatsFor('YYYY/MM/DD', 'HH:mm')

    expect(formats.dateFormat).toBe('YYYY/MM/DD')
    expect(formats.date(INSTANT)).toBe(formatDate(INSTANT, 'YYYY/MM/DD'))
    expect(formats.dateTime(INSTANT)).toBe(formatDateTime(INSTANT, 'YYYY/MM/DD', 'HH:mm'))
  })

  it('falls back to the Redash default patterns outside any provider', () => {
    const { result } = renderHook(() => useVizFormats())

    expect(result.current).toBe(DEFAULT_VIZ_FORMATS)
    expect(result.current.dateFormat).toBe(DEFAULT_DATE_FORMAT)
    expect(result.current.timeFormat).toBe(DEFAULT_TIME_FORMAT)
  })

  it('reads the formats a provider supplies', () => {
    const custom = formatsFor('DD.MM.YYYY', 'HH:mm')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <VizFormatsProvider value={custom}>{children}</VizFormatsProvider>
    )

    const { result } = renderHook(() => useVizFormats(), { wrapper })

    expect(result.current).toBe(custom)
  })
})
