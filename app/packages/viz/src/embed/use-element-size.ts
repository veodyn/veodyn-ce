'use client'

import { useEffect, useState } from 'react'

export interface ElementSize {
  width: number
  height: number
}

export function useElementSize(element: HTMLElement | null): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null)
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize((current) =>
        current && current.width === width && current.height === height ? current : { width, height }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return size
}
