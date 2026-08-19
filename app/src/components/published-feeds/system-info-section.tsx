'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SuggestInput, type Suggestion } from '@/components/shared/suggest-input'
import { systemFieldsFor } from '@/lib/gbfs-fields'
import { LANGUAGE_SUBTAGS } from '@/lib/language-subtags'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

interface SystemInfoSectionProps {
  version: string
  value: Record<string, string>
  onChange: (field: string, next: string) => void
  errors: Record<string, string>
  /** The timezone enum this deployment's capabilities read reported. */
  timezones: string[]
}

const LANGUAGE_SUGGESTIONS: Suggestion[] = LANGUAGE_SUBTAGS.map(([value, label]) => ({
  value,
  label,
}))

// What system_information.json declares and no query returns. Typed in rather
// than mapped, and rendered from the version because 3.0 requires two fields
// 2.3 does not.
//
// Two of these fields have a vocabulary GBFS defines, so neither is left to be
// remembered: timezone is an enum in the schema the validator judges a publish
// against, language a pattern with a list of subtags behind it. A field whose
// vocabulary arrived empty falls back to the plain text input, which is what a
// capabilities read that failed or has not landed yet leaves behind.
export function SystemInfoSection({
  version,
  value,
  onChange,
  errors,
  timezones,
}: SystemInfoSectionProps) {
  const prefix = useId()
  const suggestions: Record<string, Suggestion[]> = {
    language: LANGUAGE_SUGGESTIONS,
    timezone: timezones.map((zone) => ({ value: zone })),
  }

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>System</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {systemFieldsFor(version).map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`${prefix}-${field}`} className="font-mono text-xs">
              {field}
            </Label>
            {suggestions[field]?.length ? (
              <SuggestInput
                id={`${prefix}-${field}`}
                value={value[field] ?? ''}
                onChange={(next) => onChange(field, next)}
                suggestions={suggestions[field]}
                invalid={Boolean(errors[field])}
              />
            ) : (
              <Input
                id={`${prefix}-${field}`}
                type="text"
                value={value[field] ?? ''}
                aria-invalid={Boolean(errors[field])}
                onChange={(event) => onChange(field, event.target.value)}
              />
            )}
            {errors[field] && (
              <p role="alert" className="text-sm text-destructive">
                {errors[field]}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
