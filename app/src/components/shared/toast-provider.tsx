'use client'

import { toast } from 'sonner'
import { capture, currentRoute } from '@/lib/observability/capture'
import { EVENTS } from '@/lib/observability/events'

// sonner (mounted as <Toaster /> from '@/components/ui/sonner') owns the stack,
// the live region and dismissal.
//
// The id derived from (type, message) is the dedupe: sonner's reducer merges
// into a toast already on screen with that id instead of appending a second.
//
// `error` is the telemetry seam. Failure surfaces as toasts rather than thrown
// exceptions, so every failure a user is shown passes through this function.
// `errorId` is optional so existing callers keep compiling; add it on-touch.
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
