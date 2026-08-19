'use client'

import { useState } from 'react'
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
}: SuggestInputProps) {
  const [open, setOpen] = useState(false)
  // State-backed, not a ref: the positioner reads the anchor during its own
  // render, where a child-assigned ref would still be null on the opening pass.
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)

  const needle = value.trim().toLowerCase()
  const matches = suggestions.filter(
    (suggestion) =>
      !needle ||
      suggestion.value.toLowerCase().includes(needle) ||
      suggestion.label?.toLowerCase().includes(needle)
  )

  return (
    <Popover open={open && matches.length > 0}>
      <Command
        shouldFilter={false}
        className="w-full overflow-visible rounded-none! border-none bg-transparent p-0!"
      >
        <div ref={setAnchor}>
          <Input
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-invalid={invalid}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              onChange(event.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false)
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
