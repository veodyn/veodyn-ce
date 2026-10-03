'use client'

import { useState, type DragEvent } from 'react'

const GRABBABLE = 'cursor-grab active:cursor-grabbing select-none'
const BEING_DRAGGED = 'opacity-40'
const DROP_TARGET = 'bg-accent text-accent-foreground'

export function useColumnDrag(onReorder?: (movedName: string, targetName: string) => void) {
  const [draggedName, setDraggedName] = useState<string | null>(null)
  const [dropTargetName, setDropTargetName] = useState<string | null>(null)

  const endDrag = () => {
    setDraggedName(null)
    setDropTargetName(null)
  }

  const dragProps = (name: string) => {
    if (!onReorder) return {}
    return {
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer?.setData('text/plain', name)
        setDraggedName(name)
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!draggedName || draggedName === name) return
        e.preventDefault()
        setDropTargetName(name)
      },
      onDragLeave: () => setDropTargetName((current) => (current === name ? null : current)),
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault()
        const moved = draggedName ?? e.dataTransfer?.getData('text/plain')
        endDrag()
        if (moved && moved !== name) onReorder(moved, name)
      },
      onDragEnd: endDrag,
    }
  }

  const dragClassName = (name: string) => {
    if (!onReorder) return undefined
    if (draggedName === name) return `${GRABBABLE} ${BEING_DRAGGED}`
    if (dropTargetName === name) return `${GRABBABLE} ${DROP_TARGET}`
    return GRABBABLE
  }

  return { dragProps, dragClassName }
}
