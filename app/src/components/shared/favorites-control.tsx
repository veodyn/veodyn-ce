'use client'

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToggleFavorite, type FavoriteType } from '@/hooks/use-favorites'
import { IconButton } from '@/components/shared/icon-button'

interface FavoritesControlProps {
  /** Which library the object belongs to. The hook picks the backend from it. */
  type: FavoriteType
  /** A Redash id is a number; a KPI or report id is its slug. */
  id: number | string
  isFavorite: boolean
  className?: string
}

export function FavoritesControl({ type, id, isFavorite, className }: FavoritesControlProps) {
  const toggleFavorite = useToggleFavorite()

  return (
    <IconButton
      // A filled star and an empty one only read as a pair once you have seen
      // both, so the tooltip names the state as well as the action.
      tooltip={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        toggleFavorite.mutate({ type, id, favorite: !isFavorite })
      }}
      className={className}
    >
      <Star
        className={cn(
          'h-4 w-4',
          isFavorite ? 'fill-favorite text-favorite' : 'text-muted-foreground'
        )}
      />
    </IconButton>
  )
}
