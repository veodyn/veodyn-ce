import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDataSources } from '@/lib/mock-data'
import { resetStores } from '@/test/utils'
import { chooseOption, restoreDatasets, seedDatasets } from './visual-builder-test-fixtures'
import { renderQueryEditorPage } from './query-editor-page-test-fixtures'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

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

beforeEach(seedDatasets)
afterEach(() => {
  restoreDatasets()
  resetStores()
})

async function openVisualMode(user: ReturnType<typeof userEvent.setup>) {
  renderQueryEditorPage({ aiEnabled: true })
  await user.click(await screen.findByRole('tab', { name: 'Visual' }))
  return screen.findByRole('region', { name: 'Visualization' })
}

describe('QueryEditorPage Visual/PRO toggle', () => {
  it('opens the Visual builder from PRO, and the top PRO tab goes straight back', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    expect(screen.getByText('Visual builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('SQL editor')).not.toBeInTheDocument()

    // The top PRO tab used to arm a confirmation panel instead of doing the
    // thing it is named after. It switches, and only one of the two surfaces is
    // ever mounted, so there is no hidden buffer underneath the other.
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))

    expect(screen.queryByText(/This is one way/)).not.toBeInTheDocument()
    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument()
    expect(screen.queryByText('Visual builder')).not.toBeInTheDocument()
  })

  it('lets the analyst pick which catalog dataset the builder composes over', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    expect(screen.getByRole('combobox', { name: 'Dataset' })).toHaveTextContent('Trips Daily')

    await chooseOption(user, 'Dataset', 'Bare Daily')

    expect(await screen.findByText(/no column metadata/i)).toBeInTheDocument()
  })

  it('runs the compiled SQL from the builder and stays in Visual', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Running query...')).toBeInTheDocument()
    // The shared results pane below the builder is where the rows land.
    expect(await screen.findByText(/Query executed successfully/i)).toBeInTheDocument()

    // Run does not move the analyst anywhere: the builder is still shown and
    // the tab is still reachable.
    expect(screen.getByText('Visual builder')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Visual' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  // ── Finding 5: PRO-only controls are not mounted in Visual mode ────────────
  it('does not mount the prompt bar or the PRO editor controls in Visual mode', async () => {
    const user = userEvent.setup()
    renderQueryEditorPage({ aiEnabled: true })

    // PRO mode (default): the prompt bar and the editor controls are present.
    expect(await screen.findByRole('textbox', { name: 'Generate SQL with AI' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Format' })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Visual' }))

    // Visual mode: no prompt bar, and no Format, which only means anything
    // against text in the Monaco buffer this mode does not show. Run and Save
    // are deliberately not the discriminators: both surfaces name those
    // actions the same way because they are the same actions, and the builder
    // owns its own. What must be absent are the controls that act on a buffer
    // nobody can see.
    expect(screen.queryByRole('textbox', { name: 'Generate SQL with AI' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Format' })).not.toBeInTheDocument()

    // Save is here, and it is the builder's: composing a query and keeping it
    // used to be two different things with only one button between them.
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  // ── Every Visual->PRO transition is a handoff, and none of them is a lock ──
  it('hands the SQL to PRO and leaves the door open behind it', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await user.click(screen.getByRole('button', { name: 'Open in SQL Editor' }))

    expect(screen.getByLabelText('SQL editor')).toHaveValue(TRIPS_SQL)
    expect(screen.getByRole('button', { name: 'Save *' })).toBeEnabled()

    // The Visual tab is live and re-opens the builder, which is the whole
    // point: this used to be where the query was locked to PRO for good.
    const visualTab = screen.getByRole('tab', { name: 'Visual' })
    expect(visualTab).not.toHaveAttribute('aria-disabled', 'true')
    await user.click(visualTab)
    expect(await screen.findByText('Visual builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('SQL editor')).not.toBeInTheDocument()
  })

  // The toggle chooses what is below it, so it must not live inside what it
  // switches. It used to be mounted in the editor column, which sits to the
  // right of the PRO schema rail and spans the page in Visual mode, so the
  // control slid sideways under the pointer that had just clicked it. jsdom
  // does no layout and cannot see that move, but containment is what causes it
  // and containment it can see.
  it('keeps the mode toggle out of the column it switches', async () => {
    const user = userEvent.setup()
    renderQueryEditorPage({ aiEnabled: true })

    // The id QueryEditorPage puts on the column holding the editor and results.
    const column = () => document.getElementById('query-editor-container')
    const tablist = () => screen.getByRole('tablist', { name: 'Authoring mode' })

    expect(await screen.findByLabelText('SQL editor')).toBeInTheDocument()
    expect(column()).toBeInTheDocument()
    expect(column()).not.toContainElement(tablist())
    const row = tablist().parentElement

    await user.click(screen.getByRole('tab', { name: 'Visual' }))

    expect(await screen.findByText('Visual builder')).toBeInTheDocument()
    expect(column()).toBeInTheDocument()
    expect(column()).not.toContainElement(tablist())
    // The same DOM node, not merely an equivalent one: a toggle React tore down
    // and rebuilt somewhere else is exactly the jump this is about.
    expect(tablist().parentElement).toBe(row)
  })

  it('the top PRO tab is a round trip too', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))

    expect(screen.getByLabelText('SQL editor')).toHaveValue(TRIPS_SQL)

    await user.click(screen.getByRole('tab', { name: 'Visual' }))
    expect(await screen.findByText('Visual builder')).toBeInTheDocument()
    expect(screen.queryByLabelText('SQL editor')).not.toBeInTheDocument()
  })

  it('carries the field picks across the round trip', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await user.click(screen.getByRole('button', { name: 'service_date' }))

    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))
    const composed = ((await screen.findByLabelText('SQL editor')) as HTMLTextAreaElement).value
    expect(composed).toContain('service_date')

    await user.click(screen.getByRole('tab', { name: 'Visual' }))

    // The builder unmounts while PRO is on screen, so without the page holding
    // the draft this pick was gone and the analyst rebuilt the spec by hand.
    expect(await screen.findByRole('button', { name: 'service_date' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    // And the picks still compose the same query, not just the same chips.
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))
    expect(((await screen.findByLabelText('SQL editor')) as HTMLTextAreaElement).value).toBe(
      composed
    )
  })

  // Visual mode says nothing about what PRO is holding. It used to: a notice
  // stood over the Run button warning that leaving would replace hand-written
  // SQL. Not replacing it is better than warning about replacing it.
  it('keeps hand-written PRO SQL without announcing it in Visual', async () => {
    const user = userEvent.setup()
    renderQueryEditorPage({ aiEnabled: true })

    await user.type(await screen.findByLabelText('SQL editor'), 'SELECT hand_written FROM elsewhere')
    await user.click(screen.getByRole('tab', { name: 'Visual' }))

    await screen.findByText('Visual builder')
    expect(screen.queryByText(/PRO holds SQL/i)).not.toBeInTheDocument()

    // Still there on the way back: not announcing it is not losing it.
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))
    expect(screen.getByLabelText('SQL editor')).toHaveValue('SELECT hand_written FROM elsewhere')
  })

  it('leaves hand-written SQL alone even after composing a query in Visual', async () => {
    const user = userEvent.setup()
    renderQueryEditorPage({ aiEnabled: true })

    const typed = 'SELECT hand_written FROM elsewhere'
    await user.type(await screen.findByLabelText('SQL editor'), typed)
    await user.click(screen.getByRole('tab', { name: 'Visual' }))
    await user.click(await screen.findByRole('button', { name: 'service_date' }))

    // The tab is navigation, so it hands nothing over on top of their query.
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))
    expect(screen.getByLabelText('SQL editor')).toHaveValue(typed)

    // The button named for it still does, and the picks were waiting.
    await user.click(screen.getByRole('tab', { name: 'Visual' }))
    await user.click(await screen.findByRole('button', { name: 'Open in SQL Editor' }))
    expect(screen.getByLabelText('SQL editor')).toHaveValue(
      'SELECT service_date\nFROM trips_daily\nLIMIT 100'
    )
  })

  // ── The left rail is a PRO surface ─────────────────────────────────────────
  it('leaves the schema tree behind when Visual mode opens', async () => {
    const user = userEvent.setup()
    renderQueryEditorPage({ aiEnabled: true })

    // PRO: the rail is the schema browser plus the data source picker.
    expect(await screen.findByPlaceholderText('Search schema...')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Visual' }))

    // The tree browses the connection's tables, which are not what the builder
    // composes over, and clicking one appended its name to the PRO buffer this
    // mode does not show. Gone, rather than sitting there doing that quietly.
    expect(screen.queryByPlaceholderText('Search schema...')).not.toBeInTheDocument()
  })

  it('keeps the data source reachable in Visual mode, since Run executes against it', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    // One picker, in the pane: the rail that used to hold it is unmounted.
    expect(screen.getAllByRole('combobox', { name: 'Data source' })).toHaveLength(1)
    const other = mockDataSources[1].name
    await chooseOption(user, 'Data source', other)

    // And the choice is the page's, not the pane's, so PRO opens on it too.
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))
    expect(screen.getByRole('combobox', { name: 'Data source' })).toHaveTextContent(other)
  })

  // ── Finding 6: switching dataset does not leak the old dataset's SQL ───────
  it('does not hand a previous dataset SQL to PRO after switching datasets', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    // Pick a dimension that only trips_daily has, then compile it.
    await user.click(screen.getByRole('button', { name: 'service_date' }))
    expect(screen.getByRole('combobox', { name: 'Dataset' })).toHaveTextContent('Trips Daily')

    // Switch to another dataset and leave for PRO.
    await chooseOption(user, 'Dataset', 'Joined Daily')
    await user.click(screen.getByRole('button', { name: 'Open in SQL Editor' }))

    const handedOff = (screen.getByLabelText('SQL editor') as HTMLTextAreaElement).value
    expect(handedOff).toContain('joined_daily')
    expect(handedOff).not.toContain('trips_daily')
  })

  it('does not leak the previous dataset SQL through the top PRO tab either', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await user.click(screen.getByRole('button', { name: 'service_date' }))
    expect(screen.getByRole('combobox', { name: 'Dataset' })).toHaveTextContent('Trips Daily')

    // Nine Bad Slug does not compile, so the builder has nothing to publish.
    // The lifted SQL used to keep standing at the previous dataset's query, and
    // the top PRO tab would hand that over: a query over a table the analyst
    // had already moved off.
    await chooseOption(user, 'Dataset', 'Nine Bad Slug')
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))

    const handedOff = (await screen.findByLabelText('SQL editor')) as HTMLTextAreaElement
    expect(handedOff.value).not.toContain('trips_daily')
  })
})
