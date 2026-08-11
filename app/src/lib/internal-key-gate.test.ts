// @vitest-environment node
//
// The internal API key acts as its OWNING Redash user, not as the caller, and
// that owner is a super admin. So two things have to hold, and neither can be
// checked by a suite that mocks the gate out:
//
//   1. INTERNAL_KEY_ENDPOINTS declares, for each path, what Redash itself
//      demands. Asserted against the sources in node/, because a table
//      of permissions written from memory is a table that drifts.
//   2. redashFetch refuses the key to a session that does not satisfy the
//      declaration, and to a path that declares nothing at all.

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorIds } from './errorIds'
import { INTERNAL_KEY_ENDPOINTS, type RedashPermission } from './redash-server'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// Where the endpoints this app proxies are declared upstream. Add a file here
// if a future entry lives in another handler module.
const REDASH_HANDLERS = ['node/redash/handlers/__init__.py', 'node/redash/handlers/admin.py']

/** The permission decorator Redash puts on the handler serving `path`. */
function redashGateFor(path: string): RedashPermission | null {
  for (const file of REDASH_HANDLERS) {
    const lines = readFileSync(resolve(REPO_ROOT, file), 'utf8').split('\n')
    const start = lines.findIndex(
      (line) => line.startsWith('@routes.route(') && line.includes(`"${path}"`)
    )
    if (start === -1) continue

    const decorators: string[] = []
    for (let i = start + 1; i < lines.length && !lines[i].startsWith('def '); i++) {
      decorators.push(lines[i])
    }
    const text = decorators.join('\n')
    if (text.includes('@require_super_admin')) return 'super_admin'
    if (text.includes('@require_admin')) return 'admin'
    return null
  }
  return null
}

async function loadServer() {
  vi.resetModules()
  process.env.REDASH_URL = 'https://redash.example'
  process.env.REDASH_INTERNAL_API_KEY = 'internal-key-abc'
  delete process.env.REDASH_API_KEY
  return import('./redash-server')
}

async function rejection(promise: Promise<unknown>): Promise<{ id?: string } | null> {
  try {
    await promise
    return null
  } catch (err) {
    return err as { id?: string }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.REDASH_URL
  delete process.env.REDASH_INTERNAL_API_KEY
})

describe('INTERNAL_KEY_ENDPOINTS against the Redash handlers', () => {
  it.each(Object.entries(INTERNAL_KEY_ENDPOINTS))(
    '%s is declared with the permission Redash gates it with',
    (path, declared) => {
      // A mismatch means this app would let a weaker session through than
      // Redash would. Fix the table, or the route, before relaxing this.
      expect(redashGateFor(path)).toBe(declared)
    }
  )

  it('reads the real handlers, so an unknown path resolves to no gate', () => {
    expect(redashGateFor('/api/queries')).toBeNull()
  })
})

describe('redashFetch and the internal key', () => {
  it.each(Object.entries(INTERNAL_KEY_ENDPOINTS))(
    'refuses %s to a session missing %s',
    async (path, required) => {
      const { redashFetch } = await loadServer()
      const spy = vi.spyOn(globalThis, 'fetch')
      const permissions = ['admin', 'super_admin']
        .filter((p) => p !== required)
        .concat('create_query')

      const err = await rejection(redashFetch(path, { internalKeyFor: { id: 7, permissions } }))

      expect(err?.id).toBe(ErrorIds.AUTH_FORBIDDEN)
      expect(spy).not.toHaveBeenCalled()
    }
  )

  it('refuses a path that declares no Redash gate', async () => {
    const { redashFetch } = await loadServer()
    const spy = vi.spyOn(globalThis, 'fetch')

    const err = await rejection(
      redashFetch('/api/data_sources', {
        internalKeyFor: { id: 7, permissions: ['admin', 'super_admin'] },
      })
    )

    expect(err?.id).toBe(ErrorIds.AUTH_INTERNAL_KEY_UNGATED)
    expect(spy).not.toHaveBeenCalled()
  })

  it('presents the key, and no caller cookie, once the session satisfies the gate', async () => {
    const { redashFetch } = await loadServer()
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }))

    await redashFetch('/status.json', {
      cookie: 'session=super-admin',
      internalKeyFor: { id: 7, permissions: ['admin', 'super_admin'] },
    })

    const headers = spy.mock.calls[0][1]?.headers as Record<string, string>
    expect(spy.mock.calls[0][0]).toBe('https://redash.example/status.json')
    expect(headers['Authorization']).toBe('Key internal-key-abc')
    expect(headers['Cookie']).toBeUndefined()
  })
})
