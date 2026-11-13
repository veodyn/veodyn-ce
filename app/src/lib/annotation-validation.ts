// The one rule for what a valid annotation is. The manual dialog form, the
// AI suggest-annotations request, and an accepted AI suggestion all check the
// same thing here, so an AI draft cannot become a stored annotation the manual
// form would have refused (a blank label, `start: "not-a-date"`, an end before
// its start). Pure: no React, no I/O.
import { parseDateValue } from '@veodyn/viz/lib/chart-format'

export interface AnnotationDraft {
  label: string
  start: string
  end?: string | null
}

/** True when the value parses as a date/time the chart axis can place. */
export function isValidTimestamp(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '' && parseDateValue(value) !== null
}

export type AnnotationDraftField = 'label' | 'start' | 'end'

export interface AnnotationDraftIssue {
  field: AnnotationDraftField
  message: string
}

export function annotationDraftIssue(draft: AnnotationDraft): AnnotationDraftIssue | null {
  if (draft.label.trim() === '') return { field: 'label', message: 'Label is required.' }
  if (!isValidTimestamp(draft.start)) {
    return { field: 'start', message: 'Start must be a valid date and time.' }
  }
  if (draft.end != null && draft.end !== '') {
    if (!isValidTimestamp(draft.end)) {
      return { field: 'end', message: 'End must be a valid date and time.' }
    }
    const start = parseDateValue(draft.start)
    const end = parseDateValue(draft.end)
    if (start !== null && end !== null && end < start) {
      return { field: 'end', message: 'End must not be before start.' }
    }
  }
  return null
}

export function annotationDraftError(draft: AnnotationDraft): string | null {
  return annotationDraftIssue(draft)?.message ?? null
}

export function isValidAnnotationDraft(draft: AnnotationDraft): boolean {
  return annotationDraftError(draft) === null
}
