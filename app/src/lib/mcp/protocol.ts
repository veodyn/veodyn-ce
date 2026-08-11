// JSON-RPC 2.0 envelope handling for the MCP endpoint.
//
// Hand-rolled rather than taken from @modelcontextprotocol/sdk: the SDK's HTTP
// transport is written against Node's req/res, while a Next route handler
// receives a Web Request and returns a Web Response, and the adapter needed to
// bridge them is more code than the five read-only methods this server answers.
// Everything here is pure, so the protocol is testable without a backend.

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]

// JSON-RPC reserved codes. MCP adds none of its own at the envelope level: a
// tool that fails reports it inside a successful result with isError, so the
// model sees the failure rather than the transport swallowing it.
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: { code: number; message: string; data?: unknown }
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export function success(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: '2.0', id, result }
}

export function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcFailure {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } }
}

/**
 * A message with no id is a notification: the client is telling us something
 * and expects no answer. Returning one anyway is a protocol violation.
 */
export function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined
}

export function parseMessage(raw: unknown): JsonRpcRequest | null {
  if (typeof raw !== 'object' || raw === null) return null
  const message = raw as Record<string, unknown>
  if (message.jsonrpc !== '2.0') return null
  if (typeof message.method !== 'string') return null
  const id = message.id
  if (id !== undefined && typeof id !== 'string' && typeof id !== 'number' && id !== null) {
    return null
  }
  return {
    jsonrpc: '2.0',
    ...(id === undefined ? {} : { id: id as JsonRpcId }),
    method: message.method,
    params: typeof message.params === 'object' && message.params !== null
      ? (message.params as Record<string, unknown>)
      : undefined,
  }
}

/**
 * Answer the client's requested protocol version when we speak it, and our own
 * latest when we do not. The spec has the client decide whether to continue,
 * so refusing outright here would be wrong.
 */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : LATEST_PROTOCOL_VERSION
}

export interface ServerIdentity {
  name: string
  version: string
}

export function initializeResult(requestedVersion: unknown, server: ServerIdentity) {
  return {
    protocolVersion: negotiateProtocolVersion(requestedVersion),
    // Tools only. No resources, no prompts, no sampling: this server reads an
    // analytics instance and does nothing else, and advertising a capability
    // it does not implement is how a client ends up calling a method that 404s.
    capabilities: { tools: { listChanged: false } },
    serverInfo: server,
  }
}

/** MCP wraps every tool result in content blocks; text is the only kind here. */
export function toolText(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

export function toolJson(value: unknown) {
  return toolText(JSON.stringify(value, null, 2))
}
