'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { systemFieldsFor } from '@/lib/gbfs-fields'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

interface SystemInfoSectionProps {
  version: string
  value: Record<string, string>
  onChange: (field: string, next: string) => void
  errors: Record<string, string>
}

// What system_information.json declares and no query returns. Typed in rather
// than mapped, and rendered from the version because 3.0 requires two fields
// 2.3 does not.
export function SystemInfoSection({ version, value, onChange, errors }: SystemInfoSectionProps) {
  const prefix = useId()

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>System</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {systemFieldsFor(version).map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`${prefix}-${field}`} className="font-mono text-xs">
              {field}
            </Label>
            <Input
              id={`${prefix}-${field}`}
              type="text"
              value={value[field] ?? ''}
              onChange={(event) => onChange(field, event.target.value)}
            />
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
