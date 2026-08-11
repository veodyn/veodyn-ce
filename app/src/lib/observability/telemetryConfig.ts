// Shape of the telemetry config the SERVER hands the browser as a prop.
//
// Deliberately not NEXT_PUBLIC_*: Next inlines those at build time, which would
// force a separate image for the stage deployment. The root layout is already
// `force-dynamic` so instance config is read per request, and this rides the
// same path, so one image serves stage with telemetry and prod without.
export interface TelemetryClientConfig {
  key: string
  host: string
  release: string
  commit: string
  // The instance name (config.brand.name). This is a white-label product, so an
  // event is only attributable once you know which instance produced it.
  org: string
  disabled: boolean
  // Forwarding console.warn/error widens the event surface, so the operator
  // opts in per deploy rather than getting it by default.
  consoleForwarding: boolean
}

/** The single predicate every entry point checks. Empty key or host = off. */
export function telemetryEnabled(
  cfg: Pick<TelemetryClientConfig, 'key' | 'host' | 'disabled'>,
): boolean {
  return !cfg.disabled && cfg.key.length > 0 && cfg.host.length > 0
}

export function doNotTrackEnabled(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.doNotTrack === '1'
}
