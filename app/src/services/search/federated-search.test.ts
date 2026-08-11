import { describe, expect, it, vi } from 'vitest'
import { federatedSearch } from '@/services/search/federated-search'
import type { SearchSource } from '@/services/search/types'

const okQuery: SearchSource = {
  type: 'query',
  label: 'Queries',
  search: async () => [
    { id: 'query-1', type: 'query', title: 'Bus ridership', href: '/queries/1' },
  ],
}

const okDashboard: SearchSource = {
  type: 'dashboard',
  label: 'Dashboards',
  search: async () => [
    { id: 'dashboard-2', type: 'dashboard', title: 'Bus dashboard', href: '/dashboards/2' },
  ],
}

const failing: SearchSource = {
  type: 'catalog',
  label: 'Datasets',
  search: async () => {
    throw new Error('boom')
  },
}

describe('federatedSearch', () => {
  it('flattens results from every source in source order', async () => {
    const items = await federatedSearch('bus', { sources: [okQuery, okDashboard] })
    expect(items.map((i) => i.id)).toEqual(['query-1', 'dashboard-2'])
  })

  it('drops a failing source instead of rejecting the whole search', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items = await federatedSearch('bus', { sources: [okQuery, failing] })
    expect(items.map((i) => i.id)).toEqual(['query-1'])
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('E_SEARCH_001'))
    errorSpy.mockRestore()
  })

  it('threads the query and abort signal into every source', async () => {
    const controller = new AbortController()
    const seen: Array<{ query: string; signal: AbortSignal | undefined }> = []
    const spySource: SearchSource = {
      type: 'query',
      label: 'Queries',
      search: async (query, ctx) => {
        seen.push({ query, signal: ctx.signal })
        return []
      },
    }

    await federatedSearch('bus', { signal: controller.signal, sources: [spySource] })

    expect(seen).toEqual([{ query: 'bus', signal: controller.signal }])
  })

  it('passes the query through unchanged, leaving empty-query filtering to each source', async () => {
    const emptyAwareSource: SearchSource = {
      type: 'query',
      label: 'Queries',
      search: async (query) =>
        query.trim()
          ? [{ id: 'query-1', type: 'query', title: 'Bus ridership', href: '/queries/1' }]
          : [],
    }

    const items = await federatedSearch('', { sources: [emptyAwareSource] })
    expect(items).toEqual([])
  })

  it('throws when every source rejects for a real (non-abort) reason', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingQuery: SearchSource = {
      type: 'query',
      label: 'Queries',
      search: async () => {
        throw new Error('upstream down')
      },
    }
    const failingDashboard: SearchSource = {
      type: 'dashboard',
      label: 'Dashboards',
      search: async () => {
        throw new Error('upstream down too')
      },
    }

    await expect(
      federatedSearch('bus', { sources: [failingQuery, failingDashboard] })
    ).rejects.toThrow(/E_SEARCH_001|search source/i)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('E_SEARCH_001'))
    errorSpy.mockRestore()
  })

  it('still resolves with surviving items when only some sources fail', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items = await federatedSearch('bus', { sources: [okQuery, failing] })
    expect(items.map((i) => i.id)).toEqual(['query-1'])
    errorSpy.mockRestore()
  })

  it('does not log or throw when a source rejects because the search was aborted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = new AbortController()
    const abortedSource: SearchSource = {
      type: 'query',
      label: 'Queries',
      search: async (_query, ctx) => {
        controller.abort()
        return new Promise((_resolve, reject) => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          ctx.signal?.addEventListener('abort', () => reject(err))
          if (ctx.signal?.aborted) reject(err)
        })
      },
    }

    const result = await federatedSearch('bus', {
      signal: controller.signal,
      sources: [abortedSource],
    })

    expect(result).toEqual([])
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('E_SEARCH_001'))
    errorSpy.mockRestore()
  })
})
