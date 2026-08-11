"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  blur = true,
  ...props
}: DialogPrimitive.Backdrop.Props & {
  // Turn off for a dialog you are meant to work ALONGSIDE rather than answer
  // and dismiss. Blurring is right for a question, which wants the page out of
  // the way, and wrong for the AI chat: that conversation is ABOUT the
  // dashboard behind it, so the reader is describing something the blur has
  // taken away. The dim tint stays either way, so the panel still reads as
  // sitting on top of the page rather than in it.
  blur?: boolean
}) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        blur && "supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

const dialogSizes = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-lg",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  // For a dialog that is a workspace rather than a question: two panes side by
  // side, one of them a chart you are meant to judge. At xl the visualization
  // editor gave its preview about 560px and squeezed its number inputs down to
  // showing "mi" and "ma".
  "2xl": "sm:max-w-6xl",
  // For "show me this bigger". A fixed max-width can be narrower than the thing
  // it was opened from, which makes expanding a widget on a wide display shrink
  // it.
  full: "sm:max-w-[95vw]",
} as const

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = "sm",
  fill = false,
  blurBackdrop = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  size?: keyof typeof dialogSizes
  // Whether the page behind is blurred as well as dimmed. See DialogOverlay.
  blurBackdrop?: boolean
  // Opt in to a DEFINITE panel height, for a dialog that is a workspace rather
  // than a question. By default the height is auto; a percentage height inside
  // an auto-height parent resolves to auto, so a child that wants to fill the
  // dialog and scroll internally instead overflows it. Opt-in because the
  // default is right for almost every consumer: most render short content and a
  // definite height would balloon them into a tall empty box.
  //
  // "max" caps rather than fixes: the panel grows with its content and stops at
  // 85vh, after which the body scrolls. Use it when the content's height is the
  // user's (a conversation two turns in should be a short dialog, not a short
  // transcript floating in a tall empty one), and plain `fill` when the content
  // wants all the room there is, like an expanded chart. A body child under
  // "max" has to use `grow` rather than `flex-1`: flex-1 sets a flex-basis of 0,
  // which collapses to nothing inside an auto-height column.
  fill?: boolean | "max"
}) {
  return (
    <DialogPortal>
      <DialogOverlay blur={blurBackdrop} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          dialogSizes[size],
          // Either way the panel has to become a flex column, or a body child
          // asking for the leftover room means nothing.
          fill && "flex grid-cols-none flex-col",
          // h-, not max-h-: a max-height leaves the height indefinite, which is
          // the whole problem plain `fill` is solving.
          fill === true && "h-[85vh]",
          // Under the cap the height is the content's, so the header and footer
          // have to be told not to give any of theirs up: shrinking is
          // distributed across every item, and this footer holds a control.
          fill === "max" &&
            "max-h-[85vh] [&>[data-slot=dialog-footer]]:shrink-0 [&>[data-slot=dialog-header]]:shrink-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
