'use client'

import { useId, useState } from 'react'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface FormField {
  name: string
  title: string
  type: string
  default?: unknown
  required?: boolean
  placeholder?: string
  options?: { label: string; value: string }[]
  description?: string
}

interface DynamicFormProps {
  fields: FormField[]
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  className?: string
}

// A boolean option can hold a string, because these forms used to render every
// non-numeric field as a text input and saved whatever was typed. Boolean() on
// "false" is true, so the box would show the opposite of what is stored until
// the next save. Read the words back the way a person meant them.
function isChecked(value: unknown): boolean {
  if (typeof value === 'string') {
    const word = value.trim().toLowerCase()
    return word !== '' && word !== 'false' && word !== '0' && word !== 'no'
  }
  return Boolean(value)
}

// Pure, so it can be shared between the inline field-level check below and a
// pre-submit check a page runs before saving. An empty field is not a shape
// error: that is what `required` already covers, and flagging it here too
// would show two different complaints about one blank field.
//
// `fieldName` drives a shape check beyond "does it parse": the schema this
// form renders from is Redash's `configuration_schema`, a plain JSON Schema
// object whose only way to say "this string field holds a JSON document" is
// a `(JSON` suffix in the title (see schema-fields.ts's looksLikeJsonField).
// It has no room to also say what shape the parsed JSON should take, so
// there is nothing schema-driven to key this check off of. `default_devices`
// is hardcoded here rather than generalized: it is the one JSON field in the
// connector set that is a list of objects, and getting that wrong at save
// time was the actual finding this guards.
export function jsonFieldError(value: unknown, fieldName?: string): string | null {
  const text = typeof value === 'string' ? value : ''
  if (text.trim() === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'invalid syntax'
    return `Not valid JSON: ${reason}`
  }

  if (fieldName === 'default_devices') {
    const isObject = (item: unknown) => typeof item === 'object' && item !== null && !Array.isArray(item)
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isObject)) {
      return 'Must be a non-empty JSON list of device objects, e.g. [{"name": "...", "host": "..."}].'
    }
  }

  return null
}

export function DynamicForm({ fields, values, onChange, className }: DynamicFormProps) {
  // One call, suffixed per field below: fields come from a .map(), and useId()
  // cannot be called inside a loop.
  const baseId = useId()

  const handleChange = (name: string, value: unknown) => {
    onChange({ ...values, [name]: value })
  }

  return (
    <div className={cn('space-y-4', className)}>
      {fields.map((field) => {
        const fieldId = `${baseId}-${field.name}`
        const isBoolean = field.type === 'boolean'
        const isJson = field.type === 'json'
        const descId = field.description ? `${fieldId}-description` : undefined
        const rawValue = String(values[field.name] ?? field.default ?? '')
        const jsonError = isJson ? jsonFieldError(rawValue, field.name) : null
        const errorId = jsonError ? `${fieldId}-error` : undefined
        const describedBy = [descId, errorId].filter(Boolean).join(' ') || undefined

        const description = field.description ? (
          <p id={descId} className="mb-1.5 text-sm text-muted-foreground">
            {field.description}
          </p>
        ) : null

        return (
          <div key={field.name}>
            {isBoolean ? (
              // The real label for a boolean field is the one beside the
              // checkbox below; this heading only repeats the field name, so
              // it stays a div rather than a second label pointing at the
              // same control.
              <div className="block text-sm font-medium mb-1.5">
                {field.title}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </div>
            ) : (
              <Label htmlFor={fieldId} className="mb-1.5 block">
                {field.title}
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
            )}
            {description}
            {isBoolean ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={fieldId}
                  aria-describedby={descId}
                  checked={isChecked(values[field.name] ?? field.default)}
                  onCheckedChange={(checked) => handleChange(field.name, checked)}
                />
                <Label htmlFor={fieldId} className="cursor-pointer text-muted-foreground">
                  {field.title}
                </Label>
              </div>
            ) : field.type === 'select' && field.options ? (
              <Select
                value={String(values[field.name] ?? field.default ?? '')}
                onValueChange={(v) => handleChange(field.name, v)}
                items={field.options}
              >
                <SelectTrigger id={fieldId} aria-describedby={descId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : isJson ? (
              <>
                <Textarea
                  id={fieldId}
                  value={rawValue}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  rows={4}
                  aria-describedby={describedBy}
                  aria-invalid={Boolean(jsonError)}
                />
                {jsonError && (
                  <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">
                    {jsonError}
                  </p>
                )}
              </>
            ) : field.type === 'textarea' ? (
              <Textarea
                id={fieldId}
                value={rawValue}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder}
                rows={4}
                aria-describedby={descId}
              />
            ) : (
              <Input
                id={fieldId}
                type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
                value={rawValue}
                onChange={(e) =>
                  handleChange(
                    field.name,
                    field.type === 'number' ? Number(e.target.value) : e.target.value
                  )
                }
                placeholder={field.placeholder}
                aria-describedby={descId}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function useDynamicFormState(initial: Record<string, unknown> = {}) {
  const [values, setValues] = useState(initial)
  return { values, onChange: setValues, reset: () => setValues(initial) }
}
