'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface EditInPlaceProps {
  value: string
  onSave: (value: string) => void
  className?: string
  placeholder?: string
  isEditable?: boolean
}

export function EditInPlace({
  value,
  onSave,
  className,
  placeholder = 'Untitled',
  isEditable = true,
}: EditInPlaceProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    setDraft(value)
  }, [value])

  const handleSave = () => {
    setIsEditing(false)
    if (draft.trim() && draft !== value) {
      onSave(draft.trim())
    } else {
      setDraft(value)
    }
  }

  if (!isEditable) {
    return <span className={className}>{value || placeholder}</span>
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') {
            setDraft(value)
            setIsEditing(false)
          }
        }}
        className={cn(
          'bg-transparent border-b-2 border-primary outline-none px-0 py-0',
          className
        )}
      />
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => setIsEditing(true)}
      className={cn(
        'h-auto justify-start border-b border-transparent px-0 py-0 font-normal hover:border-muted-foreground/30 hover:bg-transparent',
        !value && 'text-muted-foreground italic',
        className
      )}
    >
      {value || placeholder}
    </Button>
  )
}
