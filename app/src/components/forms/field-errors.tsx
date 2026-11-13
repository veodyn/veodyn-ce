'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export function fieldErrorId(fieldId: string) {
  return `${fieldId}-error`
}

export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pendingFocus = useRef<string | null>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    document.getElementById(target)?.focus()
  }, [errors])

  const fail = useCallback((next: Record<string, string>) => {
    pendingFocus.current = Object.keys(next)[0] ?? null
    setErrors({ ...next })
  }, [])

  const clear = useCallback((fieldId: string) => {
    setErrors((prev) => {
      if (!(fieldId in prev)) return prev
      const rest = { ...prev }
      delete rest[fieldId]
      return rest
    })
  }, [])

  const reset = useCallback(() => setErrors((prev) => (Object.keys(prev).length === 0 ? prev : {})), [])

  const fieldProps = (fieldId: string) =>
    errors[fieldId]
      ? { 'aria-invalid': true as const, 'aria-describedby': fieldErrorId(fieldId) }
      : {}

  return { errors, fail, clear, reset, fieldProps }
}

export function FieldError({ fieldId, message }: { fieldId: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={fieldErrorId(fieldId)} className="mt-1 text-sm text-destructive">
      {message}
    </p>
  )
}
