'use client'

import { useId } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { FormField } from '@/components/forms/dynamic-form'
import { blankValueFor, type CredentialAction, type CredentialEdits } from './connector-credentials'

interface CredentialEditorProps {
  fields: FormField[]
  configuredFields: string[]
  clearable: string[]
  edits: CredentialEdits
  onChange: (edits: CredentialEdits) => void
}

const KEEP_LABEL: Record<'configured' | 'unset', string> = {
  configured: 'Keep the value this instance already holds',
  unset: 'Leave this unset',
}

function CredentialRow({
  field,
  configured,
  canClear,
  edits,
  onChange,
}: {
  field: FormField
  configured: boolean
  canClear: boolean
  edits: CredentialEdits
  onChange: (edits: CredentialEdits) => void
}) {
  const baseId = useId()
  const edit = edits[field.name]
  const action: CredentialAction = edit?.action ?? 'replace'
  const forced = field.required && !configured

  const setAction = (next: CredentialAction) => {
    onChange({ ...edits, [field.name]: { action: next, value: blankValueFor(field) } })
  }
  const setValue = (value: unknown) => {
    onChange({ ...edits, [field.name]: { action: 'replace', value } })
  }

  return (
    <div className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="text-sm font-medium">
        {field.title}
        {field.required && <span className="ml-1 text-destructive">*</span>}
      </div>
      {field.description && <p className="text-sm text-muted-foreground">{field.description}</p>}
      {!forced && (
        <RadioGroup
          aria-label={`What to do with ${field.title}`}
          value={action}
          onValueChange={(v) => v && setAction(v as CredentialAction)}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="keep" id={`${baseId}-keep`} />
            <Label htmlFor={`${baseId}-keep`} className="font-normal">
              {configured ? KEEP_LABEL.configured : KEEP_LABEL.unset}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="replace" id={`${baseId}-replace`} />
            <Label htmlFor={`${baseId}-replace`} className="font-normal">
              Replace it with a new value
            </Label>
          </div>
          {canClear && (
            <div className="flex items-center gap-2">
              <RadioGroupItem value="clear" id={`${baseId}-clear`} />
              <Label htmlFor={`${baseId}-clear`} className="font-normal">
                Clear it, so this connector stops sending one
              </Label>
            </div>
          )}
        </RadioGroup>
      )}
      {action === 'replace' &&
        (field.type === 'boolean' ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${baseId}-value`}
              checked={Boolean(edit?.value)}
              onCheckedChange={(checked) => setValue(Boolean(checked))}
            />
            <Label htmlFor={`${baseId}-value`} className="cursor-pointer font-normal">
              {field.title}
            </Label>
          </div>
        ) : (
          <>
            <Label htmlFor={`${baseId}-value`} className="sr-only">
              {field.title}
            </Label>
            <Input
              id={`${baseId}-value`}
              type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
              value={String(edit?.value ?? '')}
              onChange={(e) => setValue(e.target.value)}
              placeholder={field.placeholder}
            />
          </>
        ))}
    </div>
  )
}

export function CredentialEditor({
  fields,
  configuredFields,
  clearable,
  edits,
  onChange,
}: CredentialEditorProps) {
  return (
    <div className="space-y-4">
      {fields.map((field) => (
        <CredentialRow
          key={field.name}
          field={field}
          configured={configuredFields.includes(field.name)}
          canClear={configuredFields.includes(field.name) && clearable.includes(field.name)}
          edits={edits}
          onChange={onChange}
        />
      ))}
    </div>
  )
}
