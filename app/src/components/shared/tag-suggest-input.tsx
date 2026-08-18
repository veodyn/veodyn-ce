'use client'

// The add-a-tag affordance, split out of TagsControl. Hand-built rather than
// assembled from the popover primitive, whose focus trap and portal fight an
// inline chip row.
//
// It picks a candidate, it does not decide what gets stored: it hands back a
// `TagCandidate` tagged `vocabulary` (the vocabulary's own spelling) or `typed`
// (exactly what was typed), and the owner of the tag array normalizes. The
// "create <tag>" row is `typed`, since the string came from the input.

import { useId, useState, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  RESERVED_PREFIX,
  isReserved,
  normalizeTag,
  type TagCandidate,
  type TagSuggestion,
} from '@/lib/tags'

const RESERVED_MESSAGE = `Tags starting with "${RESERVED_PREFIX}" belong to domains and cannot be set here.`

/** Enough to choose from without turning the row into a scrolling panel. */
const MAX_OPTIONS = 8

interface SuggestItem {
  /** Normalized. Used for comparison and as the row's key, never submitted. */
  key: string
  /** What is handed to `onSubmit`, with its provenance attached. */
  candidate: TagCandidate
  /** How many objects already carry it, or null for the create affordance. */
  count: number | null
  label: string
}

interface TagSuggestInputProps {
  suggestions?: TagSuggestion[]
  /** Tags already on the object. Never offered again, since re-adding is a no-op. */
  existing?: string[]
  onSubmit: (candidate: TagCandidate) => void
  onDismiss?: () => void
  className?: string
  placeholder?: string
}

function buildItems(
  suggestions: TagSuggestion[],
  existing: string[],
  raw: string
): SuggestItem[] {
  const applied = new Set(existing.map(normalizeTag))
  const typed = normalizeTag(raw)
  const matches = suggestions
    .filter((s) => !isReserved(s.name) && !applied.has(normalizeTag(s.name)))
    .filter((s) => !typed || normalizeTag(s.name).includes(typed))
    .slice(0, MAX_OPTIONS)
    .map<SuggestItem>((s) => ({
      key: normalizeTag(s.name),
      // Verbatim, so tags written before normalization existed stay pickable as
      // spelled rather than being rewritten into a second, sibling tag.
      candidate: { source: 'vocabulary', value: s.name },
      count: s.count,
      label: s.name,
    }))

  // "Create" is offered only when no vocabulary row already is the tag being
  // typed, so two rows never read the same.
  const exact = matches.some((m) => m.key === typed)
  if (!typed || exact || applied.has(typed)) return matches
  return [
    ...matches,
    { key: typed, candidate: { source: 'typed', value: raw }, count: null, label: typed },
  ]
}

export function TagSuggestInput({
  suggestions = [],
  existing = [],
  onSubmit,
  onDismiss,
  className,
  placeholder = 'tag name',
}: TagSuggestInputProps) {
  const [value, setValue] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const baseId = useId()

  const typed = normalizeTag(value)
  const refused = typed !== '' && isReserved(typed)
  const items = refused ? [] : buildItems(suggestions, existing, value)
  // Clamped rather than reset in an effect: the list shrinks as the person
  // types, and a stale index would highlight a row that is no longer there.
  const active = activeIndex >= 0 && activeIndex < items.length ? activeIndex : -1

  const accept = (candidate: TagCandidate) => {
    const tag = normalizeTag(candidate.value)
    if (!tag) {
      onDismiss?.()
      return
    }
    // Enter on a reserved value must not write, whatever the inline message
    // says. The backend answers 422 for the same reason.
    if (isReserved(tag)) return
    onSubmit(candidate)
    setValue('')
    setActiveIndex(-1)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault()
      setActiveIndex(active + 1 >= items.length ? 0 : active + 1)
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault()
      setActiveIndex(active <= 0 ? items.length - 1 : active - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      accept(active >= 0 ? items[active].candidate : { source: 'typed', value })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onDismiss?.()
    }
  }

  const listId = `${baseId}-list`
  const errorId = `${baseId}-error`
  const optionId = (i: number) => `${baseId}-option-${i}`

  return (
    <span className={cn('relative inline-flex', className)}>
      <Input
        type="text"
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        aria-label="Add a tag"
        aria-invalid={refused || undefined}
        aria-describedby={refused ? errorId : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setActiveIndex(-1)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => onDismiss?.()}
        className="h-5 w-32 px-1 text-xs"
        autoFocus
        placeholder={placeholder}
      />
      {refused && (
        <span
          id={errorId}
          role="alert"
          className="absolute top-6 left-0 z-20 w-56 rounded-md border bg-popover px-2 py-1 text-xs text-destructive shadow-md"
        >
          {RESERVED_MESSAGE}
        </span>
      )}
      {items.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Tag suggestions"
          className="absolute top-6 left-0 z-20 max-h-56 w-48 overflow-auto rounded-md border bg-popover py-1 shadow-md"
        >
          {items.map((item, i) => (
            <li
              key={item.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: blur fires first and dismisses this list.
              // preventDefault keeps focus put so the pick lands.
              onMouseDown={(e) => {
                e.preventDefault()
                accept(item.candidate)
              }}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 px-2 py-1 text-xs',
                i === active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              )}
            >
              {item.count === null ? (
                <span className="inline-flex items-center gap-1">
                  <Plus className="h-3 w-3" />
                  Create &quot;{item.label}&quot;
                </span>
              ) : (
                <>
                  <span className="truncate">{item.label}</span>
                  <span className="text-muted-foreground tabular-nums">{item.count}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}
