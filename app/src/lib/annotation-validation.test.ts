// Finding 6: one annotation rule, shared by the manual dialog, the AI
// suggest-annotations request, and an accepted AI suggestion.
import { describe, expect, it } from 'vitest'
import { annotationDraftError, isValidAnnotationDraft } from './annotation-validation'

describe('annotationDraftError', () => {
  it('accepts a labelled draft with a valid start', () => {
    expect(
      annotationDraftError({ label: 'Service change', start: '2026-07-01T08:00:00Z' })
    ).toBeNull()
  })

  it('accepts the naive datetime-local value the manual form produces', () => {
    expect(annotationDraftError({ label: 'Service change', start: '2026-07-01T08:00' })).toBeNull()
  })

  it('rejects a blank or whitespace-only label', () => {
    expect(annotationDraftError({ label: '', start: '2026-07-01T08:00:00Z' })).toBe(
      'Label is required.'
    )
    expect(annotationDraftError({ label: '   ', start: '2026-07-01T08:00:00Z' })).toBe(
      'Label is required.'
    )
  })

  it.each(['', 'not-a-date', '2026-13-45T99:00:00Z'])(
    'rejects the start value %s',
    (start) => {
      expect(annotationDraftError({ label: 'Service change', start })).toBe(
        'Start must be a valid date and time.'
      )
    }
  )

  it('rejects an unparseable end', () => {
    expect(
      annotationDraftError({
        label: 'Service change',
        start: '2026-07-01T08:00:00Z',
        end: 'nonsense',
      })
    ).toBe('End must be a valid date and time.')
  })

  it('rejects an end before its start and accepts one at or after it', () => {
    expect(
      annotationDraftError({
        label: 'Service change',
        start: '2026-07-03T14:00:00Z',
        end: '2026-07-03T12:00:00Z',
      })
    ).toBe('End must not be before start.')
    expect(
      isValidAnnotationDraft({
        label: 'Service change',
        start: '2026-07-03T12:00:00Z',
        end: '2026-07-03T12:00:00Z',
      })
    ).toBe(true)
  })

  it('treats a null or empty end as an open-ended annotation', () => {
    expect(
      isValidAnnotationDraft({ label: 'Service change', start: '2026-07-01T08:00:00Z', end: null })
    ).toBe(true)
    expect(
      isValidAnnotationDraft({ label: 'Service change', start: '2026-07-01T08:00:00Z', end: '' })
    ).toBe(true)
  })
})
