import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw/server'
import { resetStores } from '@/test/utils'
import type { GenerateSqlRequest } from '@/types/ai'
import { aiDatasetFromSchema } from './query-ai-model'
import { renderQueryEditorPage } from './query-editor-page-test-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

// Monaco does not run in jsdom, so the editor is a plain textarea here. Every
// assertion below is about the SQL the page holds, never Monaco internals.
vi.mock('./query-editor', () => ({
  QueryEditor: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea
      aria-label="SQL editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

afterEach(resetStores)

function editorPane(): HTMLElement {
  const pane = document.getElementById('query-editor-container')
  if (pane === null) throw new Error('query editor pane is missing')
  return pane
}

describe('QueryEditorPage with AI disabled', () => {
  it('renders the manual editor with no AI affordance and no extra chrome', async () => {
    renderQueryEditorPage({ aiEnabled: false })

    // The manual path is complete: schema browser, controls, editor, results.
    expect(await screen.findByLabelText('SQL editor')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Save/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Format' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search schema...')).toBeInTheDocument()

    // Nothing AI is mounted: no prompt bar, no mode toggle, no Visual builder.
    expect(screen.queryByRole('textbox', { name: 'Generate SQL with AI' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Authoring mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Visual' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'SQL Editor' })).not.toBeInTheDocument()
    expect(screen.queryByText('Visual builder')).not.toBeInTheDocument()

    // And the editor pane keeps exactly its two original rows, in order, so
    // the disabled build has no layout shift from an empty AI wrapper: the
    // controls row, and the resizable editor/results split.
    const rows = Array.from(editorPane().children)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContainElement(screen.getByRole('button', { name: 'Run' }))
    expect(rows[1]).toContainElement(screen.getByLabelText('SQL editor'))
    expect(rows[1]).toContainElement(screen.getByRole('separator'))
  })

  it('exposes the editor splitter as a keyboard-operable separator that actually moves the split', async () => {
    // react-resizable-panels sizes a group by summing each panel's own
    // offsetHeight (see `ne()` in the library), not the group's own rect.
    // jsdom never runs layout, so offsetHeight is always 0; with a 0 group
    // size the library defers computing a layout at all, and a keyboard
    // nudge against that deferred state throws an internal invariant error
    // ("Previous layout not found for panel index 1") instead of moving
    // anything. This stands in for the real layout only a browser gives it.
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, 'offsetHeight', 'get')
      .mockReturnValue(300)

    try {
      const user = userEvent.setup()
      renderQueryEditorPage({ aiEnabled: false })

      const handle = await screen.findByRole('separator')
      handle.focus()
      expect(handle).toHaveFocus()

      // The role and the attribute alone would pass even if the key press
      // were silently swallowed, so the assertion that matters is that the
      // numeric position actually changed, not merely that it is present.
      const before = handle.getAttribute('aria-valuenow')
      expect(before).not.toBeNull()

      await user.keyboard('{ArrowUp}')

      const after = handle.getAttribute('aria-valuenow')
      expect(after).not.toBeNull()
      expect(after).not.toBe(before)
    } finally {
      offsetHeight.mockRestore()
    }
  })

  it('still edits SQL by hand and never calls the AI route', async () => {
    const user = userEvent.setup()
    let aiRequests = 0
    server.use(
      http.post('/api/ai/generate-sql', () => {
        aiRequests += 1
        return HttpResponse.json({ sql: 'SELECT 1', rationale: 'Unexpected request.' })
      })
    )
    renderQueryEditorPage({ aiEnabled: false })

    const editor = await screen.findByLabelText('SQL editor')
    await user.type(editor, 'SELECT 1')

    expect(editor).toHaveValue('SELECT 1')
    expect(screen.getByRole('button', { name: 'Save *' })).toBeEnabled()
    expect(aiRequests).toBe(0)
  })
})

describe('QueryEditorPage with AI enabled', () => {
  it('mounts the prompt bar and the mode toggle above the editor', async () => {
    renderQueryEditorPage({ aiEnabled: true })

    const prompt = await screen.findByRole('textbox', { name: 'Generate SQL with AI' })
    const editor = screen.getByLabelText('SQL editor')
    expect(screen.getByRole('tablist', { name: 'Authoring mode' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Visual' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'SQL Editor' })).toBeInTheDocument()

    // "Above the editor" is a document-order claim, not a styling one.
    expect(editorPane()).toContainElement(prompt)
    expect(prompt.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('puts generated SQL in the editor, grounded on the schema, without running it', async () => {
    const user = userEvent.setup()
    let received: GenerateSqlRequest | undefined
    server.use(
      http.post('/api/ai/generate-sql', async ({ request }) => {
        received = (await request.json()) as GenerateSqlRequest
        return HttpResponse.json({
          sql: 'SELECT device_id FROM vehicle_locations',
          rationale: 'Lists the vehicles reporting locations.',
        })
      })
    )
    renderQueryEditorPage({ aiEnabled: true })

    // Name the table first. The bar no longer picks one for you: on a source
    // with several tables the pick used to be schema[0], which on the real
    // instance is the catalog of table names.
    await user.type(
      await screen.findByLabelText('SQL editor'),
      'select * from vehicle_locations'
    )
    await user.type(
      await screen.findByRole('textbox', { name: 'Generate SQL with AI' }),
      'Which vehicles report locations'
    )
    await user.click(screen.getByRole('button', { name: 'Generate draft' }))

    expect(await screen.findByText('Lists the vehicles reporting locations.')).toBeVisible()
    expect(screen.getByLabelText('SQL editor')).toHaveValue(
      'SELECT device_id FROM vehicle_locations'
    )
    // The grounding is the data source schema, not the prompt.
    expect(received?.dataset.table).toBe('vehicle_locations')
    expect(received?.dataset.columns.map((column) => column.name)).toContain('device_id')

    // A draft is a draft: it is never executed for the analyst.
    expect(screen.queryByText('Running query...')).not.toBeInTheDocument()
    expect(screen.queryByText(/mock/i)).not.toBeInTheDocument()
  })

  // The defect this replaces: an empty editor on a multi-table source got a
  // draft written against historical._catalog, with a rationale asserting that
  // the catalog was the only accessible table, and a count that returned 0 for
  // a table holding 347,839 rows.
  it('asks which table rather than generating against a guess', async () => {
    renderQueryEditorPage({ aiEnabled: true })

    expect(await screen.findByText(/name the one you want in the editor/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate draft' })).toBeDisabled()
  })

  it('offers Create with AI from both authoring surfaces', async () => {
    const user = userEvent.setup()
    renderQueryEditorPage({ aiEnabled: true })

    // It belongs to the toggle's own row, which is above the columns the toggle
    // switches, so it is not inside the editor pane either mode replaces.
    const button = await screen.findByRole('button', { name: 'Create with AI' })
    expect(editorPane()).not.toContainElement(button)

    // Visual is where it was missing: the builder has no prompt of its own, so
    // switching modes used to take the only AI entry point off the page.
    await user.click(screen.getByRole('tab', { name: 'Visual' }))
    expect(await screen.findByText('Visual builder')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Generate SQL with AI' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create with AI' })).toBeInTheDocument()

    // And it opens the same conversation the library pages open.
    await user.click(screen.getByRole('button', { name: 'Create with AI' }))
    expect(await screen.findByText('Create a query with AI')).toBeInTheDocument()
  })
})

describe('aiDatasetFromSchema', () => {
  const schema = [
    { name: 'trips', columns: [{ name: 'route', type: 'String' }] },
    { name: 'stops', columns: [{ name: 'stop_id', type: 'String' }] },
  ]

  // It used to ground on schema[0] whenever the editor was empty. On the real
  // instance schema[0] is historical._catalog, the table that lists the other
  // tables, so a new query was told the catalog was its only table and wrote
  // SQL against it, explaining that "only historical._catalog is accessible
  // directly". A guess handed to the model as a fact reads back as one.
  it('grounds on nothing rather than guessing when the SQL names no table', () => {
    expect(aiDatasetFromSchema(schema, '')).toEqual({ table: '', columns: [] })
  })

  it('grounds on the one real table when a source has only one', () => {
    const single = [
      { name: 'historical._catalog', columns: [{ name: 'table_name', type: 'String' }] },
      { name: 'historical.trips', columns: [{ name: 'route', type: 'String' }] },
    ]

    // No choice to get wrong, and the catalog is never the intended one.
    expect(aiDatasetFromSchema(single, '').table).toBe('historical.trips')
  })

  it('never grounds on a catalog table by itself', () => {
    const onlyMeta = [{ name: 'historical._catalog', columns: [] }]

    expect(aiDatasetFromSchema(onlyMeta, '')).toEqual({ table: '', columns: [] })
  })

  it('grounds on the table the current SQL names', () => {
    expect(aiDatasetFromSchema(schema, 'select * from STOPS limit 1').table).toBe('stops')
  })

  it('does not match a table name inside a longer identifier', () => {
    // Two candidates and neither is named, so there is nothing to fall back to.
    expect(aiDatasetFromSchema(schema, 'SELECT * FROM stops_archive').table).toBe('')
  })

  it('returns an empty grounding when the data source has no schema', () => {
    expect(aiDatasetFromSchema([], 'SELECT 1')).toEqual({ table: '', columns: [] })
  })
})
