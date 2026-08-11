'use client'

import { useState } from 'react'
import Link from 'next/link'
import { X, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tagHref } from '@/lib/search/url'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/shared/icon-button'
import { TagSuggestInput } from '@/components/shared/tag-suggest-input'
import {
  normalizeTag,
  resolveTagCandidate,
  visibleTags,
  type TagCandidate,
  type TagSuggestion,
} from '@/lib/tags'

interface TagsControlProps {
  tags: string[]
  onChange?: (tags: string[]) => void
  className?: string
  editable?: boolean
  /**
   * The global tag vocabulary, for the add input's autocomplete. Optional: with
   * no suggestions the input degrades to free text, which is what the vocabulary
   * query failing has to look like anyway.
   */
  suggestions?: TagSuggestion[]
}

const CHIP =
  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs'

export function TagsControl({
  tags,
  onChange,
  className,
  editable = false,
  suggestions,
}: TagsControlProps) {
  const [isAdding, setIsAdding] = useState(false)

  // `domain:*` tags drive domain hubs and are never rendered, in either mode.
  // They stay in `tags` so a write built from this array cannot drop them.
  const shown = visibleTags(tags)

  const handleAdd = (candidate: TagCandidate) => {
    // Only free text is normalized. A tag picked out of the vocabulary is
    // stored as the vocabulary spells it, or picking the `Rail` on screen would
    // write a `rail` beside it and the object would not appear under either.
    const tag = resolveTagCandidate(candidate)
    const key = normalizeTag(tag)
    // Compared normalized on both sides: `Rail` already on the object and a
    // freshly typed `rail` are the same tag to a person, so adding the second
    // is a no-op rather than a near-duplicate nobody can tell apart on screen.
    if (key && !tags.some((t) => normalizeTag(t) === key)) {
      onChange?.([...tags, tag])
    }
    setIsAdding(false)
  }

  const handleRemove = (tag: string) => {
    onChange?.(tags.filter((t) => t !== tag))
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {shown.map((tag) =>
        // While editing, the chip carries a remove button and stays inert: a
        // chip that both navigates away and deletes on click is a trap. Read
        // only, it is a link to everything sharing the tag.
        editable && onChange ? (
          <span key={tag} className={CHIP}>
            {tag}
            {/* icon-xs (24px) visibly grew this compact chip; size-3 overrides
                the size variant back to the icon's own footprint (12px) while
                keeping the focus-visible ring, which lives in Button's base
                classes and is unaffected by the size override. */}
            <IconButton
              tooltip="Remove tag"
              aria-label={`Remove tag ${tag}`}
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => handleRemove(tag)}
              className="size-3 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </IconButton>
          </span>
        ) : (
          <Link
            key={tag}
            href={tagHref(tag)}
            // These chips sit inside rows that are themselves links, so without
            // this the click navigates to the row's destination instead.
            onClick={(e) => e.stopPropagation()}
            aria-label={`Search for everything tagged ${tag}`}
            className={cn(CHIP, 'transition-colors hover:bg-primary/20')}
          >
            {tag}
          </Link>
        )
      )}
      {editable && onChange && (
        isAdding ? (
          <TagSuggestInput
            suggestions={suggestions}
            existing={tags}
            onSubmit={handleAdd}
            onDismiss={() => setIsAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setIsAdding(true)}
            className="gap-0.5 text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
            Add Tag
          </Button>
        )
      )}
    </div>
  )
}
