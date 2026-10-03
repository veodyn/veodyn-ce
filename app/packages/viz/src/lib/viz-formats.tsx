'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { DisplayPatterns } from './date-pattern'
import {
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  formatCalendarDate,
  formatDate,
  formatDateTime,
} from './format-datetime'

export interface Formats extends DisplayPatterns {
  date: (value: unknown) => string
  dateTime: (value: unknown) => string
  calendarDate: (value: unknown) => string
}

export function formatsFor(dateFormat: string, timeFormat: string): Formats {
  return {
    dateFormat,
    timeFormat,
    date: (value: unknown) => formatDate(value, dateFormat),
    dateTime: (value: unknown) => formatDateTime(value, dateFormat, timeFormat),
    calendarDate: (value: unknown) => formatCalendarDate(value, dateFormat),
  }
}

export const DEFAULT_VIZ_FORMATS: Formats = formatsFor(DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT)

const VizFormatsContext = createContext<Formats>(DEFAULT_VIZ_FORMATS)

export function VizFormatsProvider({ value, children }: { value: Formats; children: ReactNode }) {
  return <VizFormatsContext.Provider value={value}>{children}</VizFormatsContext.Provider>
}

export function useVizFormats(): Formats {
  return useContext(VizFormatsContext)
}
