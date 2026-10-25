import { readQueryError } from '@/lib/query-error'
import type { RedashDashboard } from '@/services/redash/types'
import type { ChatToolRequestOf } from './frames'
import { NOT_AVAILABLE } from './library-results'
import * as nodeCalls from './node-calls'
import {
  dashboardOwner,
  isSafe,
  mayPublish,
  ownsOrAdmin,
  queryOwner,
  readAccount,
  readObject,
  type Account,
  type StoredQuery,
} from './operation-access'
import {
  DESTRUCTIVE_OPS,
  type OperationCheckToolName,
  type OperationName,
  type OperationTarget,
} from './operation-changes'
import * as copy from './operation-copy'
import { MAX_OPERATION_PROBLEMS, type ChatOperationCheckResult } from './tool-results-operation'
import type { RedashTransport } from './transport'

export { ACCOUNT_UNREADABLE, NOT_ARCHIVED, UNSAFE_QUERY, onlyOwnerMay } from './operation-copy'

export type OperationRequest = ChatToolRequestOf<OperationCheckToolName>

const MAX_NAME_CHARS = 500

type Params = Record<string, unknown>

export function refusedOperation(error: string): ChatOperationCheckResult {
  return { kind: 'operation_check', ok: false, error: error.slice(0, 500), destructive: false }
}

function checked(
  op: OperationName,
  target: OperationTarget,
  params: Params,
  problems: string[],
  updatedAt?: string
): ChatOperationCheckResult {
  return {
    kind: 'operation_check',
    ok: true,
    op,
    target: { ...target, name: target.name.slice(0, MAX_NAME_CHARS) },
    params,
    destructive: DESTRUCTIVE_OPS.has(op),
    ...(updatedAt ? { snapshot: { updatedAt } } : {}),
    problems: problems.slice(0, MAX_OPERATION_PROBLEMS),
  }
}

async function forkProblems(raw: StoredQuery, account: Account, transport: RedashTransport, signal: AbortSignal) {
  const problems: string[] = []
  if (!account.permissions.includes('edit_query')) problems.push(copy.FORK_NEEDS_EDIT_QUERY)
  if (account.isAdmin) return problems
  const sources = await nodeCalls.listDataSources(transport, signal).catch((error: unknown) => {
    if (signal.aborted) throw error
    return null
  })
  if (sources === null) return problems
  const source = sources.find((one) => one.id === raw.data_source_id)
  if (!source) problems.push(copy.SOURCE_NOT_YOURS)
  else if (source.view_only) problems.push(copy.SOURCE_VIEW_ONLY)
  return problems
}

async function resolveFork(
  request: ChatToolRequestOf<'fork_query'>,
  account: Account,
  transport: RedashTransport,
  signal: AbortSignal
) {
  const { queryId } = request.args
  const raw = await readObject<StoredQuery>(transport, `queries/${queryId}`, signal)
  if (!raw) return refusedOperation(NOT_AVAILABLE)
  const copyName = copy.copyNameOf(queryId, raw.name)
  const params = { summary: `Copy ${copy.quoted(raw.name)} into a new query, ${copy.quoted(copyName)}.`, copyName }
  const problems = await forkProblems(raw, account, transport, signal)
  return checked('fork', { kind: 'query', id: queryId, name: raw.name }, params, problems)
}

interface Archivable {
  kind: copy.ArchivableKind
  id: number
  name: string
  archived: boolean
  canEdit: boolean
  owner: number | undefined
  updatedAt: string
}

async function readArchivable(
  kind: copy.ArchivableKind,
  id: number,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<Archivable | null> {
  if (kind === 'query') {
    const raw = await readObject<StoredQuery>(transport, `queries/${id}`, signal)
    if (!raw) return null
    const { name, is_archived, can_edit, updated_at } = raw
    return { kind, id, name, archived: is_archived, canEdit: can_edit ?? false, owner: queryOwner(raw), updatedAt: updated_at }
  }
  const raw = await readObject<RedashDashboard>(transport, `dashboards/${id}`, signal)
  if (!raw) return null
  const { name, is_archived, can_edit, updated_at } = raw
  return { kind, id, name, archived: is_archived, canEdit: can_edit ?? false, owner: dashboardOwner(raw), updatedAt: updated_at }
}

async function resolveArchive(
  kind: copy.ArchivableKind,
  id: number,
  restore: boolean,
  account: Account,
  transport: RedashTransport,
  signal: AbortSignal
) {
  const object = await readArchivable(kind, id, transport, signal)
  if (!object) return refusedOperation(NOT_AVAILABLE)
  const target = { kind, id, name: object.name }
  const name = copy.quoted(object.name)
  if (restore) {
    const problems = [
      ...(object.archived ? [] : [copy.NOT_ARCHIVED[kind]]),
      ...(object.canEdit || account.isAdmin ? [] : [copy.CANNOT_RESTORE[kind]]),
    ]
    const params = { summary: `Restore ${name} from the archive.`, consequence: copy.RESTORE_NOTE[kind] }
    return checked('restore', target, params, problems, object.updatedAt)
  }
  const problems = [
    ...(object.archived ? [copy.ALREADY_ARCHIVED[kind]] : []),
    ...(ownsOrAdmin(account, object.owner) ? [] : [copy.onlyOwnerMay(kind, 'archive')]),
  ]
  const params = { summary: `Archive ${name}.`, consequence: copy.archiveConsequence(kind, object.name) }
  return checked('archive', target, params, problems, object.updatedAt)
}

async function resolveFavorite(
  request: ChatToolRequestOf<'set_favorite'>,
  transport: RedashTransport,
  signal: AbortSignal
) {
  const { kind, id, favorite } = request.args
  const path = kind === 'query' ? `queries/${id}` : `dashboards/${id}`
  const raw = await readObject<{ name: string; is_favorite?: boolean }>(transport, path, signal)
  if (!raw) return refusedOperation(NOT_AVAILABLE)
  const problems = (raw.is_favorite ?? false) === favorite ? [copy.alreadyFavorite(kind, favorite)] : []
  const name = copy.quoted(raw.name)
  const summary = favorite ? `Add ${name} to your favorites.` : `Remove ${name} from your favorites.`
  return checked(favorite ? 'favorite' : 'unfavorite', { kind, id, name: raw.name }, { summary }, problems)
}

async function resolveDashboardShare(
  request: ChatToolRequestOf<'share_dashboard'>,
  account: Account,
  transport: RedashTransport,
  signal: AbortSignal
) {
  const { dashboardId, action } = request.args
  const raw = await readObject<RedashDashboard>(transport, `dashboards/${dashboardId}`, signal)
  if (!raw) return refusedOperation(NOT_AVAILABLE)
  const target = { kind: 'dashboard' as const, id: dashboardId, name: raw.name }
  const problems = [
    ...(ownsOrAdmin(account, dashboardOwner(raw)) ? [] : [copy.onlyOwnerMay('dashboard', 'share')]),
    ...(mayPublish(account, 'publish_dashboard') ? [] : [copy.DASHBOARD_NEEDS_PUBLISH]),
  ]
  const name = copy.quoted(raw.name)
  if (action === 'revoke') {
    const params = { summary: `Revoke the public link to ${name}.`, consequence: copy.REVOKE_CONSEQUENCE }
    return checked('revoke', target, params, [...problems, ...(raw.api_key ? [] : [copy.NO_LINK_TO_REVOKE.dashboard])])
  }
  const expiresAt = request.args.expiresAt ?? null
  const archived = raw.is_archived ? [copy.ARCHIVED_CANNOT_SHARE.dashboard] : []
  return checked('share', target, { summary: copy.shareSummary(name, expiresAt), expiresAt }, [...archived, ...problems])
}

async function resolveChartShare(
  request: ChatToolRequestOf<'share_visualization'>,
  account: Account,
  transport: RedashTransport,
  signal: AbortSignal
) {
  const { queryId, visualizationId, action } = request.args
  const raw = await readObject<StoredQuery>(transport, `queries/${queryId}`, signal)
  if (!raw) return refusedOperation(NOT_AVAILABLE)
  const chart = (raw.visualizations ?? []).find((one) => one.id === visualizationId)
  if (!chart) return refusedOperation(`No visualization ${visualizationId} on query ${queryId}.`)
  const chartName = chart.name || chart.type
  const target = { kind: 'visualization' as const, id: visualizationId, name: chartName, queryId }
  const problems = [
    ...(ownsOrAdmin(account, queryOwner(raw)) ? [] : [copy.onlyOwnerMay('query', 'share')]),
    ...(mayPublish(account, 'publish_visualization') ? [] : [copy.CHART_NEEDS_PUBLISH]),
  ]
  const what = `the chart ${copy.quoted(chartName)} of ${copy.quoted(raw.name)}`
  if (action === 'revoke') {
    const params = { summary: `Revoke the public link to ${what}.`, consequence: copy.REVOKE_CONSEQUENCE, queryName: raw.name }
    return checked('revoke', target, params, [...problems, ...(chart.api_key ? [] : [copy.NO_LINK_TO_REVOKE.visualization])])
  }
  const expiresAt = request.args.expiresAt ?? null
  const refreshSeconds = request.args.refreshSeconds ?? null
  const state = [
    ...(raw.is_archived ? [copy.ARCHIVED_CANNOT_SHARE.query] : []),
    ...(isSafe(raw) ? [] : [copy.UNSAFE_QUERY]),
  ]
  const params = { summary: copy.shareSummary(what, expiresAt, refreshSeconds), expiresAt, refreshSeconds, queryName: raw.name }
  return checked('share', target, params, [...state, ...problems])
}

function dispatch(request: OperationRequest, account: Account, transport: RedashTransport, signal: AbortSignal) {
  switch (request.tool) {
    case 'fork_query':
      return resolveFork(request, account, transport, signal)
    case 'archive_query':
      return resolveArchive('query', request.args.queryId, request.args.restore, account, transport, signal)
    case 'archive_dashboard':
      return resolveArchive('dashboard', request.args.dashboardId, request.args.restore, account, transport, signal)
    case 'set_favorite':
      return resolveFavorite(request, transport, signal)
    case 'share_dashboard':
      return resolveDashboardShare(request, account, transport, signal)
    case 'share_visualization':
      return resolveChartShare(request, account, transport, signal)
  }
}

export async function resolveOperation(
  request: OperationRequest,
  transport: RedashTransport,
  signal: AbortSignal
): Promise<ChatOperationCheckResult> {
  try {
    const account = await readAccount(transport, signal)
    if (!account) return refusedOperation(copy.ACCOUNT_UNREADABLE)
    return await dispatch(request, account, transport, signal)
  } catch (error) {
    if (signal.aborted) throw error
    return refusedOperation(readQueryError(error).message)
  }
}
