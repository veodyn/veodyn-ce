'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The optional expiry on an external link, in the one place all three
 * publishing surfaces can share it (report publishing, dashboard sharing,
 * embed).
 *
 * Empty is the default and means no expiry, so every link minted before this
 * field existed keeps behaving the way it always did. That is the whole reason
 * the control starts blank rather than pre-filled with a sensible-looking date:
 * a default of "30 days" would quietly change what publishing means.
 */
interface LinkExpiryFieldProps {
  value: string
  onChange: (value: string) => void
  label?: string
  description?: string
  disabled?: boolean
}

// A `datetime-local` value is wall-clock time with no zone, which is what the
// person typing it means. The backends want ISO 8601, so the browser's own
// offset is applied here and nowhere else.
//
// Returns null for empty and for anything the browser let through that Date
// cannot read, so a caller can spread the result and send no field at all.
export function toExpiresAt(value: string): string | null {
  if (!value.trim()) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

export function LinkExpiryField({
  value,
  onChange,
  label = 'Link expires',
  description = 'Leave empty for a link that does not expire.',
  disabled,
}: LinkExpiryFieldProps) {
  const inputId = useId()
  const describedById = `${inputId}-description`

  return (
    <div>
      <Label htmlFor={inputId} className="mb-1 block">
        {label} <span className="text-muted-foreground font-normal">(optional)</span>
      </Label>
      <Input
        id={inputId}
        type="datetime-local"
        value={value}
        disabled={disabled}
        aria-describedby={describedById}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full max-w-xs"
      />
      <p id={describedById} className="mt-1 text-xs text-muted-foreground">
        {description}
      </p>
    </div>
  )
}
