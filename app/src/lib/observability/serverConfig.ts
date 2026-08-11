import { config } from '@/lib/config'
import { env } from '@/lib/env'
import type { TelemetryClientConfig } from './telemetryConfig'

// SERVER ONLY: imports the env boundary. Called from the root layout, which is
// already `force-dynamic`, so the values are read per request rather than baked
// into the build. That is what lets one image serve stage with telemetry on and
// prod with it off, instead of needing a separate build for each.
export function telemetryClientConfig(): TelemetryClientConfig {
  return {
    key: env.POSTHOG_KEY,
    host: env.POSTHOG_HOST,
    release: env.APP_VERSION,
    commit: env.APP_COMMIT,
    org: config.brand.name,
    disabled: env.DISABLE_TELEMETRY,
    consoleForwarding: env.TELEMETRY_CONSOLE_FORWARDING,
  }
}
