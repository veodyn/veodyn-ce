"use client"

import * as React from "react"
// react-resizable-panels (not Base UI: Base UI has no resizable primitive).
// This is the 4.x API: `Group` / `Panel` / `Separator`, not the older
// `PanelGroup` / `PanelResizeHandle` names most shadcn snippets show.
import { Group, Panel, Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      className={cn("flex h-full w-full", className)}
      {...props}
    />
  )
}

function ResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof Panel>) {
  return (
    <Panel data-slot="resizable-panel" className={className} {...props} />
  )
}

function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "group relative flex shrink-0 items-center justify-center bg-transparent outline-none",
        "aria-[orientation=horizontal]:h-1.5 aria-[orientation=horizontal]:w-full aria-[orientation=horizontal]:cursor-row-resize",
        "aria-[orientation=vertical]:h-full aria-[orientation=vertical]:w-1.5 aria-[orientation=vertical]:cursor-col-resize",
        "hover:bg-primary/10 focus-visible:bg-primary/15 data-[separator=active]:bg-primary/15",
        "[&[aria-orientation=horizontal]>span]:h-0.5 [&[aria-orientation=horizontal]>span]:w-8",
        "[&[aria-orientation=vertical]>span]:h-8 [&[aria-orientation=vertical]>span]:w-0.5",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="rounded-full bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary"
      />
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
