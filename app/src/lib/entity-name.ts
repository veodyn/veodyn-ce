/**
 * How the name of a query, dashboard, KPI, report, or dataset is rendered
 * wherever it is listed.
 *
 * This was two different treatments picked per page. /kpis, /reports and
 * /discover set `font-display`, so a KPI's name was Newsreader; /queries,
 * /dashboards, /favorites and /schedules omitted it, so the very same object
 * was Geist one screen over. `sidecar-favorites.tsx` managed both spellings
 * inside a single file, twelve lines from the other. The name a thing is
 * called should not depend on which route you happened to reach it from.
 *
 * The display serif wins because the detail page for every one of these already
 * titles itself `font-display` (see queries/[queryId], kpis/[kpiId],
 * dashboards/[dashboardId], alerts/[alertId]). Listing a query in Geist and
 * then titling it in Newsreader when you open it made the list and the page
 * look like two different products.
 */
export const ENTITY_NAME_CLASS = 'font-display font-medium text-foreground hover:text-primary'
