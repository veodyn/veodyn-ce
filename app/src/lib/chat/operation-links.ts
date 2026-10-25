import { dashboardPublicPath, embedPublicPath, publicLinkUrl } from '@/lib/public-links'
import type { OperationParams, OperationTarget } from './operation-changes'

export function operationPublicUrl(target: OperationTarget, params: OperationParams, token: string): string {
  if (target.kind === 'dashboard') return publicLinkUrl(dashboardPublicPath(token))
  const refresh = params.refreshSeconds ? `?refresh=${params.refreshSeconds}` : ''
  return publicLinkUrl(embedPublicPath(token)) + refresh
}

export function targetHref(target: OperationTarget): string {
  if (target.kind === 'dashboard') return `/dashboards/${target.id}`
  return `/queries/${target.kind === 'visualization' ? target.queryId : target.id}`
}
