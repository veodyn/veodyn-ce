"use client"

import { Toaster as Sonner, useSonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useThemeScope } from "@/components/theme/theme-provider"

const ASSERTIVE_TYPES = new Set(["warning", "error"])

type SonnerToasts = ReturnType<typeof useSonner>["toasts"]

// The most recent non-dismissed error/warning toast, derived straight from
// sonner's own toast list rather than mirrored into local state: the list
// already re-renders this component on every toast event, so deriving during
// render keeps a single source of truth instead of a second copy that could
// drift from it. sonner's reducer PREPENDS ([toast, ...toasts]), so index 0
// is the newest toast: this walks forward from the front, not from the back.
function latestUrgentMessage(toasts: SonnerToasts): string {
  for (const toast of toasts) {
    if (toast.delete || typeof toast.title !== "string") continue
    if (ASSERTIVE_TYPES.has(toast.type ?? "")) return toast.title
  }
  return ""
}

// sonner renders one internal live region for the whole stack: a <section
// aria-live="polite">, hardcoded (verified against its source: no prop
// overrides it, and no toast carries a role of its own — the string "role:"
// does not appear in the bundle at all). That already covers success and
// info correctly, so nothing is added for them. It does not cover error and
// warning: a refusal has to interrupt a screen reader rather than wait its
// turn behind other speech, the way a save confirmation can, and sonner has
// no way to promote one toast's announcement to assertive. So this mirrors
// only the urgent case into a second, always-mounted, visually hidden
// role="alert"/aria-live="assertive" region. The residual cost: an error or
// warning is announced twice, once assertively by this region and once
// politely by sonner's own, because sonner's announcement cannot be
// suppressed without hiding the toast text from the accessibility tree
// entirely. That is a deliberate trade of a duplicate announcement for an
// interrupt, not an oversight. The region stays mounted even when empty, for
// the same reason the old provider's container did: a live region that
// appears at the same moment as its content is often missed by screen
// readers.
function AssertiveAnnouncer() {
  const { toasts } = useSonner()
  const message = latestUrgentMessage(toasts)

  return (
    <div role="alert" aria-live="assertive" className="sr-only">
      {message}
    </div>
  )
}

const Toaster = ({ ...props }: ToasterProps) => {
  // This app scopes light/dark through its own ThemeProvider (a React context
  // toggling .dark on a display:contents wrapper), not next-themes, so the
  // scope comes from useThemeScope rather than the next-themes hook the
  // generator wires in by default.
  const scope = useThemeScope()

  return (
    <>
      <Sonner
        theme={scope}
        className="toaster group"
        // The old provider rendered a dismiss button with this accessible
        // name; sonner's closeButton defaults to off, which would have left
        // a toast only swipeable or wait-outable, a real loss for keyboard
        // and pointer users. closeButtonAriaLabel keeps the accessible name
        // from silently changing to sonner's own default ("Close toast").
        closeButton
        icons={{
          success: (
            <CircleCheckIcon className="size-4" />
          ),
          info: (
            <InfoIcon className="size-4" />
          ),
          warning: (
            <TriangleAlertIcon className="size-4" />
          ),
          error: (
            <OctagonXIcon className="size-4" />
          ),
          loading: (
            <Loader2Icon className="size-4 animate-spin" />
          ),
        }}
        style={
          {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--border-radius": "var(--radius)",
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: "cn-toast",
          },
          closeButtonAriaLabel: "Dismiss notification",
        }}
        {...props}
      />
      <AssertiveAnnouncer />
    </>
  )
}

export { Toaster }
