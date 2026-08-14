'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { PublishedFeedInput } from '@/types/published-feed'

interface OnFailureSectionProps {
  onError: PublishedFeedInput['onError']
  onOnErrorChange: (value: PublishedFeedInput['onError']) => void
  lastGoodMaxAgeSeconds: string
  onLastGoodMaxAgeSecondsChange: (value: string) => void
  ageError?: string | null
}

/**
 * Mirrors the API's own constraint on the cap
 * (`last_good_max_age_seconds: int | None = Field(default=None, gt=0, ...)`,
 * required exactly when `on_error` is `last_good`). Exported so feed-form.tsx
 * can run the same check at submit time, rather than the section here being
 * the only place that knows it: left blank, `Number('')` is 0, which passes
 * every other local check and reaches the API as a `gt=0` violation instead
 * of a refusal this form could have caught.
 */
export function lastGoodAgeError(onError: PublishedFeedInput['onError'], raw: string): string | null {
  if (onError !== 'last_good') return null
  const trimmed = raw.trim()
  if (!trimmed) return 'A maximum age in seconds is required when serving the last known good artifact.'
  const age = Number(trimmed)
  if (!Number.isInteger(age) || age <= 0) {
    return 'The maximum age must be a whole number of seconds greater than zero.'
  }
  return null
}

/**
 * Split out of feed-form.tsx to keep that file under the size hook, not to
 * satisfy it with a hook: a hook returning `onError`/`lastGoodMaxAgeSeconds`
 * setters would make every callback that closes over them fail
 * react-hooks/preserve-manual-memoization. A component split has no such
 * cost, since the state itself stays in feed-form.tsx.
 *
 * The age cap only renders in `last_good` mode: the API refuses a cap on
 * `block` and requires one on `last_good` (a 422 on the mismatch either way),
 * so offering the field in the mode that forbids it would only ever produce a
 * refusal the reader could not have predicted from the form.
 */
export function OnFailureSection({
  onError,
  onOnErrorChange,
  lastGoodMaxAgeSeconds,
  onLastGoodMaxAgeSecondsChange,
  ageError,
}: OnFailureSectionProps) {
  const blockId = useId()
  const lastGoodId = useId()
  const ageId = useId()

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>On failure</h2>
      <RadioGroup
        value={onError}
        onValueChange={(v) => v && onOnErrorChange(v as PublishedFeedInput['onError'])}
      >
        <div className="flex items-start gap-2">
          <RadioGroupItem value="block" id={blockId} className="mt-0.5" />
          <Label htmlFor={blockId} className="font-normal">
            Block: refuse to serve a bad read.
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem value="last_good" id={lastGoodId} className="mt-0.5" />
          <Label htmlFor={lastGoodId} className="font-normal">
            Last known good: keep serving the last good artifact for a bounded age.
          </Label>
        </div>
      </RadioGroup>
      {onError === 'last_good' && (
        <div className="space-y-1">
          <Label htmlFor={ageId}>Maximum age (seconds)</Label>
          <Input
            id={ageId}
            type="number"
            min={1}
            value={lastGoodMaxAgeSeconds}
            onChange={(e) => onLastGoodMaxAgeSecondsChange(e.target.value)}
            placeholder="300"
          />
          {ageError && (
            <p role="alert" className="text-sm text-destructive">
              {ageError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
