// Saving from Visual mode, end to end through the page, plus what a save is
// allowed to change about a query that is not its SQL.
//
// The builder's Save carries its own SQL rather than letting the page read the
// buffer, for the same reason Run does: the buffer is a render behind, and in
// Visual mode it is usually empty, so a page-side save would have created an
// empty query or overwritten a real one with nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMockDataStore } from '@/stores/mock-data-store'
import { resetStores } from '@/test/utils'
import { restoreDatasets, seedDatasets } from './visual-builder-test-fixtures'
import { renderQueryEditorPage } from './query-editor-page-test-fixtures'

const { push, updatePayloads } = vi.hoisted(() => ({
  push: vi.fn(),
  updatePayloads: [] as Record<string, unknown>[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

// Records what the page actually sends. "The query is still a draft" is true of
// a payload that carries is_draft and of one that does not, and only the second
// is correct: publication state is not the save button's to touch.
vi.mock('@/hooks/use-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-queries')>()
  function useUpdateQuery() {
    const mutation = actual.useUpdateQuery()
    return {
      ...mutation,
      mutate: (vars: Parameters<typeof mutation.mutate>[0]) => {
        updatePayloads.push(vars)
        return mutation.mutate(vars)
      },
      mutateAsync: (vars: Parameters<typeof mutation.mutateAsync>[0]) => {
        updatePayloads.push(vars)
        return mutation.mutateAsync(vars)
      },
    }
  }
  return { ...actual, useUpdateQuery }
})

vi.mock('./query-editor', () => ({
  QueryEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea
      aria-label="SQL editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const TRIPS_SQL = 'SELECT *\nFROM trips_daily\nLIMIT 100'

beforeEach(() => {
  push.mockClear()
  updatePayloads.length = 0
  seedDatasets()
})
afterEach(() => {
  restoreDatasets()
  resetStores()
})

async function saveFromVisualMode(queryId?: number) {
  const user = userEvent.setup()
  renderQueryEditorPage({ aiEnabled: true, queryId })
  await user.click(await screen.findByRole('tab', { name: 'Visual' }))
  await user.click(await screen.findByRole('button', { name: 'Save' }))
  return user
}

const queries = () => useMockDataStore.getState().queries

describe('saving a query composed in Visual mode', () => {
  it('creates the query with the composed SQL and opens it', async () => {
    const before = queries().length

    await saveFromVisualMode()

    await waitFor(() => expect(queries()).toHaveLength(before + 1))
    const created = queries().at(-1)
    expect(created?.query).toBe(TRIPS_SQL)
    expect(push).toHaveBeenCalledWith(`/queries/${created?.id}/source`)
  })

  it('updates an existing query rather than creating a second one', async () => {
    const target = queries()[0]
    const before = queries().length

    await saveFromVisualMode(target.id)

    await waitFor(() => expect(queries().find((q) => q.id === target.id)?.query).toBe(TRIPS_SQL))
    expect(queries()).toHaveLength(before)
    // An update stays put: nothing to navigate to, the analyst is already here.
    expect(push).not.toHaveBeenCalled()
  })

  it('leaves the saved SQL in the PRO buffer, not the empty one Visual mode left', async () => {
    // Whatever was saved is what PRO must show on the way back, and it must
    // read as saved rather than as an unsaved edit.
    const target = queries()[0]
    const user = await saveFromVisualMode(target.id)

    await waitFor(() => expect(queries().find((q) => q.id === target.id)?.query).toBe(TRIPS_SQL))
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))

    expect(await screen.findByLabelText('SQL editor')).toHaveValue(TRIPS_SQL)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

const stored = (id: number) => queries().find((q) => q.id === id)

async function saveFromPro(queryId: number, sql: string, queryDrafts: boolean) {
  const user = userEvent.setup()
  renderQueryEditorPage({ aiEnabled: false, queryId, queryDrafts })
  const editor = await screen.findByLabelText('SQL editor')
  // The query arrives async and seeds the buffer. Typing before that lands
  // gets overwritten by the seed, so wait for the stored SQL to show up.
  await waitFor(() => expect(editor).toHaveValue(stored(queryId)?.query ?? ''))
  await user.clear(editor)
  await user.type(editor, sql)
  await user.click(screen.getByRole('button', { name: 'Save *' }))
}

async function createFromPro(sql: string, queryDrafts: boolean) {
  const user = userEvent.setup()
  renderQueryEditorPage({ aiEnabled: false, queryDrafts })
  await user.type(await screen.findByLabelText('SQL editor'), sql)
  await user.click(screen.getByRole('button', { name: 'Save *' }))
}

// Save used to send is_draft: false with every update unconditionally, so the
// first Save listed the query for the whole org and the next one silently undid
// Unpublish. With the draft workflow ON that is still the wrong thing to do.
describe('with the draft workflow on, saving does not change who can find a query', () => {
  it('sends no is_draft at all, and leaves a draft a draft', async () => {
    const target = queries()[0]
    useMockDataStore.getState().updateQuery(target.id, { is_draft: true })

    await saveFromPro(target.id, 'SELECT 101', true)

    await waitFor(() => expect(stored(target.id)?.query).toBe('SELECT 101'))
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).not.toHaveProperty('is_draft')
    expect(stored(target.id)?.is_draft).toBe(true)
  })

  it('leaves a shared query shared', async () => {
    // The other direction, so a save that hardcoded is_draft: true would fail
    // here rather than pass both tests by flipping the coupling around.
    const target = queries()[0]
    useMockDataStore.getState().updateQuery(target.id, { is_draft: false })

    await saveFromPro(target.id, 'SELECT 202', true)

    await waitFor(() => expect(stored(target.id)?.query).toBe('SELECT 202'))
    expect(stored(target.id)?.is_draft).toBe(false)
  })

  it('creates a new query as a draft, so sharing it stays a decision', async () => {
    // Redash's is_draft defaults to true and nothing here overrides it. A first
    // save that shared would put a scratch query in front of the whole org
    // before its author had a chance to name it.
    const before = queries().length

    await createFromPro('SELECT 42', true)

    await waitFor(() => expect(queries()).toHaveLength(before + 1))
    expect(queries().at(-1)?.is_draft).toBe(true)
  })
})

// The default. There is no control anywhere that shares a query, so Save is the
// moment it has to reach the team, on update and on create alike. A save that
// left the query a draft would leave it findable by nobody but its author with
// no way in the product to change that.
describe('with the draft workflow off, saving shares the query', () => {
  it('sends is_draft: false on update, and shares a query that was a draft', async () => {
    const target = queries()[0]
    useMockDataStore.getState().updateQuery(target.id, { is_draft: true })

    await saveFromPro(target.id, 'SELECT 303', false)

    await waitFor(() => expect(stored(target.id)?.query).toBe('SELECT 303'))
    expect(updatePayloads).toHaveLength(1)
    expect(updatePayloads[0]).toMatchObject({ is_draft: false })
    expect(stored(target.id)?.is_draft).toBe(false)
  })

  it('creates a new query already shared', async () => {
    const before = queries().length

    await createFromPro('SELECT 404', false)

    await waitFor(() => expect(queries()).toHaveLength(before + 1))
    expect(queries().at(-1)?.is_draft).toBe(false)
  })
})
