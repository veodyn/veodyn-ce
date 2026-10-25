import type { OperationPayload } from './operation-changes'
import type { RedashTransport } from './transport'

export interface Written {
  targetId: number
  updatedAt?: string
  token?: string
}

interface Saved {
  id: number
  updated_at?: string
}

const PLURAL = { query: 'queries', dashboard: 'dashboards' } as const

function expected(payload: OperationPayload, overwrite: boolean): string | undefined {
  return overwrite ? undefined : payload.snapshot?.updatedAt
}

function objectPath(payload: OperationPayload): string {
  const kind = payload.target.kind === 'dashboard' ? 'dashboard' : 'query'
  return `${PLURAL[kind]}/${payload.target.id}`
}

function sharePath(payload: OperationPayload): string {
  const { target } = payload
  return target.kind === 'visualization' ? `visualizations/${target.id}/share` : `dashboards/${target.id}/share`
}

export async function forkQuery(
  transport: RedashTransport,
  queryId: number,
  idempotencyKey: string,
  signal?: AbortSignal
): Promise<Saved> {
  return transport.post<Saved>(`queries/${queryId}/fork`, { idempotency_key: idempotencyKey }, signal)
}

export async function publishFork(transport: RedashTransport, forkId: number, signal?: AbortSignal): Promise<Saved> {
  return transport.post<Saved>(`queries/${forkId}`, { is_draft: false }, signal)
}

export async function writeOperation(
  payload: OperationPayload,
  transport: RedashTransport,
  overwrite: boolean,
  signal?: AbortSignal
): Promise<Written> {
  const { op, target } = payload
  const stamp = expected(payload, overwrite)
  switch (op) {
    case 'archive':
      await transport.del<void>(objectPath(payload), stamp === undefined ? undefined : { expected_updated_at: stamp }, signal)
      return { targetId: target.id }
    case 'restore': {
      const body = stamp === undefined ? { is_archived: false } : { is_archived: false, expected_updated_at: stamp }
      const saved = await transport.post<Saved>(objectPath(payload), body, signal)
      return { targetId: target.id, updatedAt: saved?.updated_at }
    }
    case 'favorite':
      await transport.post<void>(`${objectPath(payload)}/favorite`, {}, signal)
      return { targetId: target.id }
    case 'unfavorite':
      await transport.del<void>(`${objectPath(payload)}/favorite`, undefined, signal)
      return { targetId: target.id }
    case 'share': {
      const expiresAt = payload.params.expiresAt
      const shared = await transport.post<{ api_key?: string }>(sharePath(payload), expiresAt ? { expires_at: expiresAt } : {}, signal)
      return { targetId: target.id, token: shared?.api_key }
    }
    case 'revoke':
      await transport.del<void>(sharePath(payload), undefined, signal)
      return { targetId: target.id }
    case 'fork':
      throw new Error('A fork is written by applyOperation.')
  }
}
