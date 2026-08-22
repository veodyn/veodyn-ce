// The route table and the publication guard for the docs screenshot capture.
//
// Data only, so the driver (docs-screenshots.spec.ts) stays readable and so
// adding a documented page is a one-line change here. Not named `.spec.` on
// purpose: Playwright must not collect it.

/**
 * Every image under docs/static/img/screenshots/ that is a plain navigation,
 * paired with the route that produces it. The name is the filename without
 * `.png`, and it has to keep matching, because the docs pages reference these
 * by name and `cd docs && pnpm build` fails on a broken reference.
 *
 * Nine more images are not in here because they are not plain navigations:
 * login, invite and reset are captured signed out, chart-editor,
 * visual-builder and ai-create-chat each need a surface driven open, and three
 * are pack-only states this harness cannot reach. The spec carries those and
 * asserts the total.
 */
export const AUTHED_SCREENS: ReadonlyArray<{ name: string; path: string }> = [
  // Home and finding things
  { name: 'home', path: '/' },
  { name: 'discover', path: '/discover' },
  { name: 'favorites', path: '/favorites' },
  { name: 'search', path: '/search?q=ridership' },

  // Queries
  { name: 'queries-list', path: '/queries' },
  { name: 'query-view', path: '/queries/1' },
  { name: 'query-editor', path: '/queries/1/source' },
  { name: 'query-new', path: '/queries/new' },
  // 12 is the gallery's choropleth query, so this is the one capture showing a
  // map visualization at full size rather than as a gallery tile.
  { name: 'choropleth-view', path: '/queries/12' },

  // Dashboards. 5 is the visualization gallery, which is what viz-gallery
  // documents: every chart surface the build draws, on one grid.
  { name: 'dashboards-list', path: '/dashboards' },
  { name: 'dashboard-view', path: '/dashboards/1' },
  { name: 'viz-gallery', path: '/dashboards/5' },
  { name: 'present-mode', path: '/present/1' },
  { name: 'wall', path: '/wall' },

  // KPIs
  { name: 'kpis-list', path: '/kpis' },
  { name: 'kpi-detail', path: '/kpis/on-time-performance' },
  { name: 'kpi-edit', path: '/kpis/on-time-performance/edit' },
  { name: 'kpi-new', path: '/kpis/new' },

  // Reports
  { name: 'reports-list', path: '/reports' },
  { name: 'report-view', path: '/reports/service-reliability-review' },
  { name: 'report-editor', path: '/reports/service-reliability-review/edit' },
  { name: 'report-new', path: '/reports/new' },

  // Data catalog
  { name: 'data-catalog', path: '/data' },
  { name: 'dataset-detail', path: '/data/dataset/route-ridership-daily' },
  { name: 'domain-hub', path: '/data/transit' },

  // Monitoring
  { name: 'captures', path: '/captures' },
  { name: 'schedules', path: '/schedules' },

  // Alerts and destinations
  { name: 'alerts-list', path: '/alerts' },
  { name: 'alert-detail', path: '/alerts/1' },
  { name: 'alert-new', path: '/alerts/new' },
  { name: 'destinations-list', path: '/destinations' },
  { name: 'destination-detail', path: '/destinations/1' },

  // Connect
  { name: 'connect-apis', path: '/connect/apis' },
  { name: 'connect-mcp', path: '/connect/mcp' },
  { name: 'connect-feeds', path: '/connect/feeds' },
  { name: 'connect-feed-new', path: '/connect/feeds/new' },
  // vehicles-live is the neutral pack's GTFS-Realtime binding.
  { name: 'connect-feed-detail', path: '/connect/feeds/vehicles-live' },

  // Admin
  { name: 'admin-data-sources', path: '/data-sources' },
  { name: 'data-source-detail', path: '/data-sources/1' },
  { name: 'data-source-new', path: '/data-sources/new' },
  { name: 'admin-team', path: '/users' },
  { name: 'admin-settings', path: '/settings' },
  { name: 'admin-shared-links', path: '/admin/shared-links' },
  { name: 'admin-status', path: '/admin/status' },
  { name: 'admin-jobs', path: '/admin/jobs' },
  { name: 'admin-outdated', path: '/admin/outdated' },
  { name: 'admin-plugins', path: '/admin/plugins' },
]

/** Signed out, so they are captured from a context that never authenticates. */
export const ANONYMOUS_SCREENS: ReadonlyArray<{ name: string; path: string }> = [
  { name: 'login', path: '/login' },
  { name: 'invite', path: '/invite/example-invitation-token' },
  { name: 'reset', path: '/reset/example-reset-token' },
]

/**
 * The publication guard, applied to the rendered text of every page captured.
 *
 * The neutral pack is the mechanism that makes these images publishable, and
 * src/lib/mock-data/packs/neutral/neutral.debranding.test.ts already asserts
 * the pack itself is clean. That test serializes fixtures; this one reads what
 * a browser actually painted, which is the only place a string the fixtures do
 * not contain can still appear: a hardcoded label, a config default, a plugin
 * display name, or a route that quietly fell back to a different pack.
 *
 * So a hit here is a finding about the product or the pack, not about the
 * screenshot, and it fails the run rather than being cropped out.
 *
 * The terms are the ones Plan 4A's audit found in the images captured against
 * the previous pack, generalised to the surrounding real-world network rather
 * than kept to the exact strings it happened to see. Deliberately not included:
 * "transit", "freeway", "rail" and "metro" on their own, which are the neutral
 * pack's own generic domain vocabulary.
 */
export const FORBIDDEN_ON_SCREEN: ReadonlyArray<RegExp> = [
  /riits/i,
  /onriits/i,
  /lacmta/i,
  /gurunetwork/i,
  /los angeles/i,
  /\bla county\b/i,
  /\bla metro\b/i,
  /metro rail/i,
  /metro bike/i,
  /metrolink/i,
  /caltrans/i,
  /go511/i,
  /trafficland/i,
  /socaltransport/i,
  /union station/i,
  /freeway service patrol/i,
  /\bfsp\b/i,
  /willowbrook/i,
  /wilshire/i,
  /hollywood/i,
  /crenshaw/i,
  /\bexpo line\b/i,
]

/**
 * A neutral-pack fixture that has to be on screen before anything is written.
 *
 * NEXT_PUBLIC_REDASH_URL is set in .env.local for anyone developing against a
 * real backend, and the empty value the config passes has to beat it or
 * activePack() resolves to packs/empty.ts and the whole run captures 49 blank
 * pages. Rather than trusting the precedence, the run proves it from what the
 * browser rendered.
 */
export const NEUTRAL_PACK_PROOF = 'Transportation Overview'
