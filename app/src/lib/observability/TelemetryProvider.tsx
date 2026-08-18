'use client'

import type React from 'react'
import { useEffect } from 'react'
import { markReady } from './capture'
import { installConsoleForwarding } from './consoleForwarding'
import { installGlobalHandlers } from './errorForwarding'
import { APP_NAME } from './events'
import { sessionRecordingOptions } from './replayMasking'
import { scrubEvent } from './scrub'
import { doNotTrackEnabled, type TelemetryClientConfig, telemetryEnabled } from './telemetryConfig'

/**
 * Initialises posthog-js exactly once.
 *
 * Must stay OUTSIDE IdentityScopedQueryProvider, which remounts on every
 * sign-out: inside it, PostHog is re-initialised on each identity change and
 * the session recording is lost each time.
 *
 * The SDK is imported dynamically, inside the effect and after the enabled
 * check, because a static import is a build-time fact while `disabled` is a
 * runtime one. Measured on a production build: 227 KB raw / 62 KB brotli off a
 * /login payload of 1398 KB raw / 387 KB brotli.
 */
export function TelemetryProvider({
  config,
  children,
}: {
  config: TelemetryClientConfig
  children: React.ReactNode
}): React.ReactNode {
  // Primitive locals, so the effect deps are stable across the fresh config
  // object the server layout allocates each render.
  const { key, host, release, commit, org, disabled, consoleForwarding } = config

  useEffect(() => {
    if (!telemetryEnabled({ key, host, disabled }) || doNotTrackEnabled()) return

    // The import resolves a tick or more after this effect runs and the
    // component can unmount in between, so `teardown` starts as that flag and
    // becomes the real cleanup once there is something to clean.
    let cancelled = false
    let teardown = () => {
      cancelled = true
    }

    void import('posthog-js').then(({ default: posthog }) => {
      if (cancelled) return
      posthog.init(key, {
        api_host: host,
        person_profiles: 'identified_only',
        autocapture: true,
        // "history_change" also catches client-side navigations. `true` fires
        // only on the initial document load, and this provider never remounts.
        capture_pageview: 'history_change',
        capture_pageleave: true,
        session_recording: sessionRecordingOptions,
        // before_send must never throw into the SDK, so a scrub failure falls
        // back to sending the event rather than taking telemetry down with it.
        before_send: (event) => {
          try {
            return scrubEvent(event)
          } catch {
            return event
          }
        },
        loaded: (ph) => ph.register({ app: APP_NAME, release, commit, org }),
      })
      markReady(posthog)
      const uninstallErrors = installGlobalHandlers()
      const uninstallConsole = consoleForwarding ? installConsoleForwarding() : () => {}
      teardown = () => {
        uninstallErrors()
        uninstallConsole()
        markReady(null)
      }
    })

    return () => teardown()
  }, [key, host, release, commit, org, disabled, consoleForwarding])

  return children
}
