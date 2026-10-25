import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api-client'
import type { ChatToolRequestOf } from './frames'
import { CANNOT_CHANGE_SNIPPET, noSnippet, resolveSnippetCheck } from './snippet-check'
import type { RedashTransport } from './transport'

const signal = new AbortController().signal

const SNIPPET = {
  id: 3,
  trigger: 'dt',
  description: 'Date trunc',
  snippet: "date_trunc('day', ts)",
  user: { id: 7, name: 'Owner' },
  created_at: 'a',
  updated_at: '2026-10-01T00:00:00Z',
}

function transportFor(options: { snippet?: unknown; userId?: number; admin?: boolean; sessionFails?: boolean } = {}) {
  const get = vi.fn(async (path: string) => {
    if (path === 'query_snippets/3') {
      if (options.snippet === null) throw new ApiError(404, 'gone')
      return options.snippet ?? SNIPPET
    }
    if (path === 'session') {
      if (options.sessionFails) throw new Error('no session')
      return { user: { id: options.userId ?? 7, permissions: options.admin ? ['admin'] : [] } }
    }
    throw new Error(`unexpected ${path}`)
  })
  return { get, post: vi.fn(), del: vi.fn() } as unknown as RedashTransport
}

function edit(args: Record<string, unknown>): ChatToolRequestOf<'update_snippet'> {
  return { callId: 'c', tool: 'update_snippet', args: { snippetId: 3, ...args } }
}

const DELETE: ChatToolRequestOf<'delete_snippet'> = { callId: 'c', tool: 'delete_snippet', args: { snippetId: 3 } }

describe('resolveSnippetCheck', () => {
  it('returns the stored snippet and only the fields that differ', async () => {
    const result = await resolveSnippetCheck(
      edit({ trigger: 'dt', snippet: "date_trunc('week', ts)", description: 'Date trunc' }),
      transportFor(),
      signal
    )
    expect(result).toEqual({
      kind: 'snippet_check',
      ok: true,
      mode: 'edit',
      snippetId: 3,
      snapshot: {
        trigger: 'dt',
        snippet: "date_trunc('day', ts)",
        description: 'Date trunc',
        updatedAt: '2026-10-01T00:00:00Z',
      },
      changes: { snippet: "date_trunc('week', ts)" },
    })
  })

  it('reports no changes when every value already matches, treating a missing description as empty', async () => {
    const result = await resolveSnippetCheck(
      edit({ description: '' }),
      transportFor({ snippet: { ...SNIPPET, description: null } }),
      signal
    )
    expect(result).toMatchObject({ ok: true, mode: 'edit', changes: {}, snapshot: { description: '' } })
  })

  it('answers a delete with the snapshot and no changes', async () => {
    const result = await resolveSnippetCheck(DELETE, transportFor(), signal)
    expect(result).toMatchObject({ kind: 'snippet_check', ok: true, mode: 'delete', snippetId: 3 })
    expect(result).not.toHaveProperty('changes')
  })

  it('says so when the snippet is gone', async () => {
    const result = await resolveSnippetCheck(DELETE, transportFor({ snippet: null }), signal)
    expect(result).toEqual({ kind: 'snippet_check', ok: false, error: noSnippet(3) })
  })

  it('refuses a user who is neither the owner nor an admin', async () => {
    const result = await resolveSnippetCheck(DELETE, transportFor({ userId: 9 }), signal)
    expect(result).toMatchObject({ ok: false, error: CANNOT_CHANGE_SNIPPET })
  })

  it('lets an admin change a snippet that is not theirs', async () => {
    const result = await resolveSnippetCheck(DELETE, transportFor({ userId: 9, admin: true }), signal)
    expect(result).toMatchObject({ ok: true, mode: 'delete' })
  })

  it('leaves the permission to the server when the session cannot be read', async () => {
    const result = await resolveSnippetCheck(DELETE, transportFor({ sessionFails: true }), signal)
    expect(result).toMatchObject({ ok: true, mode: 'delete' })
  })

  it('refuses a snippet longer than chat can carry', async () => {
    const result = await resolveSnippetCheck(
      edit({ trigger: 'x' }),
      transportFor({ snippet: { ...SNIPPET, snippet: 'x'.repeat(10_001) } }),
      signal
    )
    expect(result).toMatchObject({ ok: false })
  })
})
