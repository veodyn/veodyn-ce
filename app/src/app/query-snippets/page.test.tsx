// The gate on the route itself, from both postures. Hiding the nav row is not
// enough: a bookmarked or guessed /query-snippets has to stop at the server, or
// the feature is off in the menu and on everywhere else.
import { describe, expect, it, vi, beforeEach } from 'vitest'

const instance = vi.hoisted(() => ({ querySnippets: false }))

vi.mock('@/lib/config', () => ({
  config: {
    get features() {
      return { query_snippets: instance.querySnippets }
    },
  },
}))

// The real notFound() throws a Next control-flow error; this stands in for it
// so the test can tell "refused" from "rendered".
const NOT_FOUND = new Error('NEXT_NOT_FOUND')
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw NOT_FOUND
  },
}))

vi.mock('./query-snippets-page', () => ({
  QuerySnippetsPage: () => null,
}))

async function renderRoute() {
  const { default: Page } = await import('./page')
  return Page()
}

describe('the /query-snippets route', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('is not there when the feature is off', async () => {
    instance.querySnippets = false

    await expect(renderRoute()).rejects.toBe(NOT_FOUND)
  })

  it('serves the page when an instance turns the feature on', async () => {
    instance.querySnippets = true

    await expect(renderRoute()).resolves.toBeTruthy()
  })
})
