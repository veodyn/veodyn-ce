"use client"

import { Toaster as Sonner, useSonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useThemeScope } from "@/components/theme/theme-provider"

const ASSERTIVE_TYPES = new Set(["warning", "error"])

type SonnerToasts = ReturnType<typeof useSonner>["toasts"]

// The most recent non-dismissed error/warning toast, derived from sonner's own
// list rather than mirrored into state. sonner's reducer PREPENDS
// ([toast, ...toasts]), so index 0 is the newest and this walks from the front.
function latestUrgentMessage(toasts: SonnerToasts): string {
  for (const toast of toasts) {
    if (toast.delete || typeof toast.title !== "string") continue
    if (ASSERTIVE_TYPES.has(toast.type ?? "")) return toast.title
  }
  return ""
}

// sonner's own live region is a hardcoded <section aria-live="polite"> for the
// whole stack, with no prop to promote one toast to assertive. That is right for
// success and info; an error or a warning has to interrupt, so the urgent case
// is mirrored here into a second, always-mounted, visually hidden
// role="alert"/aria-live="assertive" region. The cost is that those are
// announced twice, which is the trade for the interrupt. Always mounted because
// a live region appearing with its content is often missed by screen readers.
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
  // This app scopes light/dark through its own ThemeProvider, not next-themes,
  // so the scope comes from useThemeScope and not the generator's default hook.
  const scope = useThemeScope()

  return (
    <>
      <Sonner
        theme={scope}
        className="toaster group"
        // sonner's closeButton defaults to off, which leaves a toast only
        // swipeable or wait-outable and unreachable from the keyboard.
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
