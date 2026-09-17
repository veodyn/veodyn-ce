'use client'

import { useState } from 'react'
import { usePublishedFeeds } from '@/hooks/use-published-feeds'
import type { PublishedFeed } from '@/types/published-feed'

export function referencesAlreadyBound(
  feeds: PublishedFeed[] | undefined,
  boundHere: string | null
): string[] {
  const bound = new Set<string>()
  for (const feed of feeds ?? []) {
    if (feed.standard !== 'gtfs-rt') continue
    const reference = feed.staticGtfsRef?.trim()
    if (reference) bound.add(reference)
  }
  const here = boundHere?.trim()
  if (here) bound.add(here)
  return [...bound].sort()
}

export function theOnlyReference(options: string[]): string {
  return options.length === 1 ? options[0] : ''
}

export interface StaticGtfsRefControl {
  value: string
  options: string[]
  entering: boolean
  pick: (next: string) => void
  enter: (next: string) => void
  enterNew: () => void
  reset: () => void
}

export function useStaticGtfsRef(boundHere: string | null): StaticGtfsRefControl {
  const { data: feeds } = usePublishedFeeds()
  const [chosen, setChosen] = useState<string | null>(boundHere)
  const [entering, setEntering] = useState(false)

  const options = referencesAlreadyBound(feeds, boundHere)
  const value = chosen ?? theOnlyReference(options)
  const enterNew = () => {
    setChosen(value)
    setEntering(true)
  }

  return {
    value,
    options,
    entering: entering || options.length === 0,
    pick: setChosen,
    enter: (next: string) => {
      setChosen(next)
      setEntering(true)
    },
    enterNew,
    reset: () => {
      setChosen(null)
      setEntering(false)
    },
  }
}
