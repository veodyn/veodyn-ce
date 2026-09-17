import { AppError, ErrorIds, isAppError } from '@/lib/errorIds'
import type { Connector, ConnectorInput, ConnectorType, ConnectorUpdate } from '@/types/connector'

function wrapError(error: unknown): Error {
  if (isAppError(error)) return error
  if (error instanceof Error && error.name === 'AbortError') return error
  return new AppError(ErrorIds.CONNECTOR_REQUEST_FAILED, 'connector request failed', {
    cause: error instanceof Error ? error.message : String(error),
  })
}

async function refusal(res: Response, fallback: string): Promise<AppError> {
  let message = fallback
  let errorId: string | undefined
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') message = body.error
    if (typeof body?.error?.message === 'string') message = body.error.message
    if (typeof body?.error?.id === 'string') errorId = body.error.id
  } catch {
    message = fallback
  }
  return new AppError(ErrorIds.CONNECTOR_REQUEST_FAILED, message, { status: res.status, errorId })
}

export async function fetchConnectorTypes(opts: { signal?: AbortSignal } = {}): Promise<ConnectorType[]> {
  try {
    const res = await fetch('/api/connectors/types', { credentials: 'include', signal: opts.signal })
    if (!res.ok) throw await refusal(res, `connector types fetch failed (${res.status})`)
    return (await res.json()) as ConnectorType[]
  } catch (error) {
    throw wrapError(error)
  }
}

export async function fetchConnectors(opts: { signal?: AbortSignal } = {}): Promise<Connector[]> {
  try {
    const res = await fetch('/api/connectors', { credentials: 'include', signal: opts.signal })
    if (!res.ok) throw await refusal(res, `connectors fetch failed (${res.status})`)
    return (await res.json()) as Connector[]
  } catch (error) {
    throw wrapError(error)
  }
}

export async function fetchConnector(
  connectorId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<Connector | null> {
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}`, {
      credentials: 'include',
      signal: opts.signal,
    })
    if (res.status === 404) return null
    if (!res.ok) throw await refusal(res, `connector fetch failed (${res.status})`)
    return (await res.json()) as Connector
  } catch (error) {
    throw wrapError(error)
  }
}

export async function createConnector(input: ConnectorInput): Promise<Connector> {
  try {
    const res = await fetch('/api/connectors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw await refusal(res, `could not save these credentials (${res.status})`)
    return (await res.json()) as Connector
  } catch (error) {
    throw wrapError(error)
  }
}

export async function updateConnector(connectorId: string, input: ConnectorUpdate): Promise<Connector> {
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw await refusal(res, `could not save these credentials (${res.status})`)
    return (await res.json()) as Connector
  } catch (error) {
    throw wrapError(error)
  }
}

export async function deleteConnector(connectorId: string): Promise<void> {
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(connectorId)}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (!res.ok) throw await refusal(res, `could not remove this connector (${res.status})`)
  } catch (error) {
    throw wrapError(error)
  }
}
