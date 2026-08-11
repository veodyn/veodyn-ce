'use client'

import { toast } from 'sonner'
import { capture, currentRoute } from '@/lib/observability/capture'
import { EVENTS } from '@/lib/observability/events'

// The hook stays and only its implementation changed, so all 31 call sites are
// untouched. sonner (mounted as <Toaster /> from '@/components/ui/sonner')
// owns the stack, the live region and dismissal now.
//
// A stable id derived from (type, message) is passed on every call. sonner
// replaces a toast in place when it is fired again with an id already on
// screen, rather than adding a second one (verified against its reducer:
// `create` looks up `alreadyExists` by id and merges instead of appending).
// That reproduces the old Zustand store's dedupe: a repeated identical
// failure updates the one toast already showing it instead of stacking N
// copies of the same message.
//
// `error` is also the telemetry seam. veodyn surfaces failure as toasts rather
// than as thrown exceptions, so every failure a user is actually shown passes
// through this one function. That is what makes it worth instrumenting here
// rather than scattering capture calls across the call sites, and it is the
// same property that let the implementation swap from Zustand to sonner without
// touching any of them.
//
// The optional errorId lets a call site thread its ErrorIds code. It stays
// optional so the existing callers keep compiling; add it on-touch.
export function useToast() {
  return {
    success: (message: string) => toast.success(message, { id: `success:${message}` }),
    error: (message: string, opts?: { errorId?: string }) => {
      capture(EVENTS.errorShown, {
        message,
        errorId: opts?.errorId ?? '',
        route: currentRoute(),
      })
      return toast.error(message, { id: `error:${message}` })
    },
    info: (message: string) => toast.info(message, { id: `info:${message}` }),
    warning: (message: string) => toast.warning(message, { id: `warning:${message}` }),
  }
}
