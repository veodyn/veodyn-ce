// Pack-neutral home for the alert fixture shapes. `la/alerts.ts` re-exports
// these so `from './alerts'` imports inside packs/la keep resolving;
// packs/neutral imports directly from here.
export type AlertState = 'ok' | 'triggered' | 'unknown'

export interface MockAlertDestination {
  id: number
  destination_id: number
  alert_id: number
  name: string
  type: string
}

export interface MockAlert {
  id: number
  name: string
  query_id: number
  query: { id: number; name: string; data_source_id: number }
  user: { id: number; name: string; email: string }
  options: {
    column: string
    op: string
    value: number
    // Which row of the result the condition reads. Optional because most
    // alerts predate it and Redash defaults it to 'first'; a KPI-managed alert
    // always sets 'last', matching the KPI's own latest-row rule.
    selector?: string
    // The KPI this alert was derived from. A LABEL, not an authority: any user
    // can post arbitrary option keys, so use isManagedAlert (lib/managed-alert)
    // to decide whether an alert is managed, and read this only afterwards to
    // say which KPI.
    kpi_id?: string
    custom_subject?: string
    custom_body?: string
    muted: boolean
  }
  state: AlertState
  last_triggered_at: string | null
  rearm: number | null
  created_at: string
  updated_at: string
  destinations: MockAlertDestination[]
}
