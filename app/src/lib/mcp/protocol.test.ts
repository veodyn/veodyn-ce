import { describe, expect, it } from 'vitest'
import {
  initializeResult,
  isNotification,
  LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  parseMessage,
  toolJson,
  toolText,
} from '@/lib/mcp/protocol'

const SERVER = { name: 'veodyn', version: '1.0.0' }

describe('parseMessage', () => {
  it('accepts a well-formed request', () => {
    expect(parseMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: undefined,
    })
  })

  it('keeps a missing id missing, so a notification stays a notification', () => {
    const notification = parseMessage({ jsonrpc: '2.0', method: 'notifications/initialized' })
    const nullId = parseMessage({ jsonrpc: '2.0', id: null, method: 'ping' })
    if (!notification || !nullId) throw new Error('both messages are well formed')

    expect(isNotification(notification)).toBe(true)
    // A null id is a request that happens to be identified as null, not a
    // notification, and answering one of them wrongly breaks the client.
    expect(isNotification(nullId)).toBe(false)
  })

  it('refuses anything that is not a JSON-RPC 2.0 request', () => {
    expect(parseMessage({ id: 1, method: 'ping' })).toBeNull()
    expect(parseMessage({ jsonrpc: '1.0', id: 1, method: 'ping' })).toBeNull()
    expect(parseMessage({ jsonrpc: '2.0', id: 1 })).toBeNull()
    expect(parseMessage({ jsonrpc: '2.0', id: {}, method: 'ping' })).toBeNull()
    expect(parseMessage('ping')).toBeNull()
    expect(parseMessage(null)).toBeNull()
  })

  it('drops params that are not an object rather than passing junk on', () => {
    expect(parseMessage({ jsonrpc: '2.0', id: 1, method: 'ping', params: 7 })?.params).toBeUndefined()
  })
})

describe('negotiateProtocolVersion', () => {
  it('speaks the version the client asked for when it is one we know', () => {
    expect(negotiateProtocolVersion('2024-11-05')).toBe('2024-11-05')
  })

  it('answers with our latest when the client asks for one we do not know', () => {
    expect(negotiateProtocolVersion('1999-01-01')).toBe(LATEST_PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(undefined)).toBe(LATEST_PROTOCOL_VERSION)
  })
})

describe('initializeResult', () => {
  it('advertises tools and nothing it does not implement', () => {
    const result = initializeResult('2025-06-18', SERVER)

    expect(result.capabilities).toEqual({ tools: { listChanged: false } })
    expect(result.serverInfo).toEqual(SERVER)
    expect(result.protocolVersion).toBe('2025-06-18')
  })
})

describe('tool content', () => {
  it('wraps text in a content block', () => {
    expect(toolText('done')).toEqual({ content: [{ type: 'text', text: 'done' }], isError: false })
  })

  it('marks a failure so the model sees it', () => {
    expect(toolText('nope', true).isError).toBe(true)
  })

  it('serialises data readably', () => {
    expect(toolJson({ a: 1 })).toEqual({
      content: [{ type: 'text', text: '{\n  "a": 1\n}' }],
      isError: false,
    })
  })
})
