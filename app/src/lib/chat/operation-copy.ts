import { removalCopy } from '@/lib/removal'
import type { REFRESH_SECONDS } from './operation-changes'

export type ArchivableKind = 'query' | 'dashboard'

export const ACCOUNT_UNREADABLE = 'Chat could not read your account, so it cannot check what you may do.'
export const UNSAFE_QUERY = 'This query uses text parameters and cannot be published.'
export const FORK_NEEDS_EDIT_QUERY = 'Forking needs the edit_query permission, which your account does not have.'
export const SOURCE_VIEW_ONLY = "This query's data source is view-only for you, so it cannot be forked."
export const SOURCE_NOT_YOURS = "You have no access to this query's data source, so it cannot be forked."
export const DASHBOARD_NEEDS_PUBLISH =
  'Sharing a dashboard needs the publish_dashboard permission, which your account does not have.'
export const CHART_NEEDS_PUBLISH =
  'Publishing a chart needs the publish_visualization permission, which your account does not have.'

export const NOT_ARCHIVED: Record<ArchivableKind, string> = {
  query: 'This query is not archived.',
  dashboard: 'This dashboard is not archived.',
}

export const ALREADY_ARCHIVED: Record<ArchivableKind, string> = {
  query: 'This query is already archived.',
  dashboard: 'This dashboard is already archived.',
}

export const CANNOT_RESTORE: Record<ArchivableKind, string> = {
  query: 'You cannot restore this query: restoring needs edit rights on it.',
  dashboard: 'You cannot restore this dashboard: restoring needs edit rights on it.',
}

export const ARCHIVED_CANNOT_SHARE: Record<ArchivableKind, string> = {
  query: 'This query is archived; restore it before publishing its charts.',
  dashboard: 'This dashboard is archived; restore it before sharing it.',
}

export const NO_LINK_TO_REVOKE = {
  dashboard: 'This dashboard has no public link to revoke.',
  visualization: 'This chart has no public link to revoke.',
} as const

const OWNER_RULES: Record<ArchivableKind, Record<'archive' | 'share', string>> = {
  query: {
    archive: "Only the query's owner or an admin can archive it.",
    share: "Only the query's owner or an admin can publish its charts.",
  },
  dashboard: {
    archive: "Only the dashboard's owner or an admin can archive it.",
    share: "Only the dashboard's owner or an admin can share it.",
  },
}

export function onlyOwnerMay(kind: ArchivableKind, verb: 'archive' | 'share'): string {
  return OWNER_RULES[kind][verb]
}

export function alreadyFavorite(kind: ArchivableKind, favorite: boolean): string {
  return favorite ? `This ${kind} is already in your favorites.` : `This ${kind} is not in your favorites.`
}

export function copyNameOf(queryId: number, name: string): string {
  return `Copy of (#${queryId}) ${name}`
}

const LINK_STOP_NOTE = ' Restoring it does not bring the link back.'

export function archiveConsequence(kind: ArchivableKind, name: string): string {
  const description = removalCopy(kind, name).description
  return kind === 'dashboard' ? description + LINK_STOP_NOTE : description
}

export const RESTORE_NOTE: Record<ArchivableKind, string> = {
  query: 'Its schedule, alerts and dashboard widgets were removed when it was archived, and they do not come back.',
  dashboard: 'Its public link does not come back; create a new one if it needs one.',
}

export const REVOKE_CONSEQUENCE = 'Anyone holding the link loses access, and a new link would have a different address.'

const REFRESH_LABEL: Record<Exclude<(typeof REFRESH_SECONDS)[number], 0>, string> = {
  30: 'reloading every 30 seconds',
  60: 'reloading every minute',
  300: 'reloading every 5 minutes',
  900: 'reloading every 15 minutes',
}

export function shareSummary(
  what: string,
  expiresAt: string | null,
  refreshSeconds?: number | null
): string {
  const label = refreshSeconds ? REFRESH_LABEL[refreshSeconds as keyof typeof REFRESH_LABEL] : undefined
  const reload = label ? `, ${label}` : ''
  const expiry = expiresAt ? `, working until ${expiresAt}` : ', with no expiry'
  return `Create a public link to ${what}${reload}${expiry}. Anyone with the link can see it without signing in.`
}

export function quoted(name: string): string {
  return `"${name}"`
}
