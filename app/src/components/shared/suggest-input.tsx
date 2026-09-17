'use client'

import { useEffect, useState } from 'react'
import { Command, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent } from '@/components/ui/popover'

export interface Suggestion {
  value: string
  /** Shown beside the value, for a vocabulary whose codes are not readable. */
  label?: string
}

interface SuggestInputProps {
  id: string
  value: string
  onChange: (next: string) => void
  suggestions: Suggestion[]
  placeholder?: string
  invalid?: boolean
  required?: boolean
}

const EXACT_CODE = 0
const CODE_PREFIX = 1
const NAME_WORD = 2
const CODE_WORD = 3
const ANYWHERE = 4
const NO_MATCH = 5

function wordsIn(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

function tierOf(suggestion: Suggestion, needle: string): number {
  const code = suggestion.value.toLowerCase()
  const name = suggestion.label?.toLowerCase() ?? ''
  if (code === needle) return EXACT_CODE
  if (code.startsWith(needle)) return CODE_PREFIX
  if (wordsIn(name).some((word) => word.startsWith(needle))) return NAME_WORD
  if (wordsIn(code).some((word) => word.startsWith(needle))) return CODE_WORD
  if (code.includes(needle) || name.includes(needle)) return ANYWHERE
  return NO_MATCH
}

function ranked(suggestions: Suggestion[], needle: string): Suggestion[] {
  return suggestions
    .map((suggestion) => ({ suggestion, tier: tierOf(suggestion, needle) }))
    .filter((entry) => entry.tier !== NO_MATCH)
    .sort((a, b) => a.tier - b.tier)
    .map((entry) => entry.suggestion)
}

// The input and the list sit under one Command root: cmdk drives arrow keys and
// Enter from the root's keydown, so a focused plain input inside it navigates
// the list, and the input is the popover's ANCHOR rather than its trigger, for
// the reason group-members.tsx gives (a trigger claims Enter).
//
// A text field that suggests, not a picker that constrains: the typed value is
// the value, so a vocabulary this list does not carry can still be entered.
// Whoever needs a closed set checks membership themselves.
export function SuggestInput({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  invalid,
  required,
}: SuggestInputProps) {
  const [open, setOpen] = useState(false)
  // State-backed, not a ref: the positioner reads the anchor during its own
  // render, where a child-assigned ref would still be null on the opening pass.
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)

  const needle = value.trim().toLowerCase()
  const matches = needle === '' ? suggestions : ranked(suggestions, needle)

  // Blur alone does not close this. A press on a region that takes no focus
  // leaves the input focused, so the list stayed open over the rest of the form
  // until something focusable was clicked.
  useEffect(() => {
    if (!open) return
    const closeUnlessInside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      if (anchor?.contains(target)) return
      if (target.closest('[data-slot="popover-content"]')) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', closeUnlessInside, true)
    return () => document.removeEventListener('pointerdown', closeUnlessInside, true)
  }, [open, anchor])

  return (
    <Popover open={open && matches.length > 0}>
      <Command
        shouldFilter={false}
        className="h-auto! w-full overflow-visible rounded-none! border-none bg-transparent p-0!"
      >
        <div ref={setAnchor}>
          <Input
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-invalid={invalid}
            aria-required={required || undefined}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            required={required}
            onChange={(event) => {
              onChange(event.target.value)
              setOpen(true)
            }}
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
              if (event.key === 'ArrowDown') setOpen(true)
            }}
          />
        </div>
        <PopoverContent
          anchor={anchor}
          align="start"
          sideOffset={4}
          className="w-(--anchor-width) p-1"
          initialFocus={false}
          // Keeps focus in the input, so onBlur does not close the popup out
          // from under the click that is selecting an item.
          onMouseDown={(event) => event.preventDefault()}
        >
          <CommandList>
            {matches.map((suggestion) => (
              <CommandItem
                key={suggestion.value}
                value={suggestion.value}
                onSelect={() => {
                  onChange(suggestion.value)
                  setOpen(false)
                }}
              >
                <span className="font-mono text-xs">{suggestion.value}</span>
                {suggestion.label && (
                  <span className="text-muted-foreground">{suggestion.label}</span>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </PopoverContent>
      </Command>
    </Popover>
  )
}
