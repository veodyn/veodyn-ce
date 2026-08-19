'use client'

import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { SUBSECTION_HEADING } from '@/lib/section-heading'
import type { PublishedFeedInput } from '@/types/published-feed'

interface AddressSectionProps {
  slug: string
  onSlugChange: (slug: string) => void
  /** Locked on edit: the slug is half the primary key and cannot be renamed. */
  slugLocked?: boolean
  slugError?: string
  visibility: PublishedFeedInput['visibility']
  onVisibilityChange: (visibility: PublishedFeedInput['visibility']) => void
}

// The feed's address and who may read it. Split from feed-form.tsx at the
// file-size limit; it is the section with no cross-field rules in it.
export function AddressSection({
  slug,
  onSlugChange,
  slugLocked,
  slugError,
  visibility,
  onVisibilityChange,
}: AddressSectionProps) {
  const slugId = useId()

  return (
    <div className="space-y-3">
      <h2 className={SUBSECTION_HEADING}>Address</h2>
      <div className="space-y-1">
        <Label htmlFor={slugId}>Slug</Label>
        <Input
          id={slugId}
          type="text"
          value={slug}
          onChange={(event) => onSlugChange(event.target.value)}
          disabled={slugLocked}
          placeholder="vehicles-live"
        />
        {slugError && (
          <p role="alert" className="text-sm text-destructive">
            {slugError}
          </p>
        )}
      </div>
      <div className="space-y-1">
        <Label>Visibility</Label>
        <RadioGroup
          value={visibility}
          onValueChange={(v) => v && onVisibilityChange(v as PublishedFeedInput['visibility'])}
        >
          <VisibilityOption value="private" label="Private" description="Only signed-in org members can read it." />
          <VisibilityOption value="public" label="Public" description="Anyone with the URL can read it." />
        </RadioGroup>
      </div>
    </div>
  )
}

function VisibilityOption({ value, label, description }: { value: string; label: string; description: string }) {
  const id = useId()
  return (
    <div className="flex items-start gap-2">
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <Label htmlFor={id} className="flex flex-col gap-0.5 font-normal">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </Label>
    </div>
  )
}
