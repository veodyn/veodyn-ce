'use client'

// The three repeated controls of the Visual builder field picker: a labelled
// section, a labelled Select over an option list, and a named remove control.
// Every one of them carries an accessible name, since the remove controls are
// icon only and the row Selects have no visible label of their own.
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from '@/components/shared/icon-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { Option } from './visual-builder-model'
import { SUBSECTION_HEADING } from '@/lib/section-heading'

export function FieldSection({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2" aria-labelledby={id}>
      <h3 id={id} className={SUBSECTION_HEADING}>
        {title}
      </h3>
      {hint != null && <p className="text-pretty text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  )
}

export function FieldSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  id?: string
  label: string
  value: string
  options: Option[]
  disabled: boolean
  onChange: (next: string) => void
  className?: string
}) {
  return (
    <Select
      value={value}
      // base-ui hands back null when a selection is cleared, which this picker
      // never wants: a field always keeps its last valid choice.
      onValueChange={(next) => {
        if (next != null) onChange(next)
      }}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={label} disabled={disabled} className={cn('w-full', className)}>
        <SelectValue placeholder="Select" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    // The label already names the row it removes ("Remove filter 2"), so the
    // tooltip and the accessible name are the same sentence.
    <IconButton
      tooltip={label}
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      onClick={onClick}
    >
      <X aria-hidden="true" />
    </IconButton>
  )
}
