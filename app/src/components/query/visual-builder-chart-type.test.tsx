// What the Visual builder's visualization picker actually does.
//
// It used to do nothing. The builder passed the picked type to its Run callback
// and QueryVisualPane declared that callback as `(sql: string) => void`, so the
// second argument was dropped one component up. TypeScript says nothing about
// that: a function of fewer parameters satisfies a function type with more. The
// control had never been wired, and picking Heatmap ran the query and showed
// whatever tabs the page already had.
//
// These pin the wiring end to end, through the real pane and page rather than a
// mocked callback, because a mocked callback is exactly what would have passed
// while the value was being dropped in between.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { resetStores } from '@/test/utils'
import { chooseViz, restoreDatasets, seedDatasets } from './visual-builder-test-fixtures'
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

beforeEach(seedDatasets)
afterEach(() => {
  restoreDatasets()
  resetStores()
})

type User = ReturnType<typeof userEvent.setup>

async function openVisualMode(user: User) {
  renderQueryEditorPage({ aiEnabled: true })
  await user.click(await screen.findByRole('tab', { name: 'Visual' }))
  return screen.findByRole('region', { name: 'Visualization' })
}

/** The result pane's own tabs, which are a different tablist to the mode toggle. */
function resultTabs(): string[] {
  const lists = screen.getAllByRole('tablist')
  const results = lists.find((list) => list.getAttribute('aria-label') !== 'Authoring mode')
  return results ? within(results).getAllByRole('tab').map((tab) => tab.textContent ?? '') : []
}

describe('Visual builder chart type', () => {
  it('lands the run in the visualization that was picked', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await chooseViz(user, 'Heatmap')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    // The tabs only mount once a result is in, so finding one is also the wait
    // for the run. The "executed successfully" text is not the signal here: it
    // is a cell of the mock result, so it is on screen only while the Table tab
    // is the selected one, which after this run it is not.
    await screen.findByRole('tab', { name: 'Heatmap' })

    // The picked type is offered, and it is the tab on screen rather than one
    // the analyst has to go and find.
    expect(resultTabs()).toEqual(['Heatmap', 'Table'])
    expect(screen.getByRole('tab', { name: 'Heatmap' })).toHaveAttribute('aria-selected', 'true')
  })

  // The five chart shapes are choices of their own now. Picking one has to land
  // a CHART carrying that shape, and say which one it was.
  it('lands a picked chart shape as a chart configured for it', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await chooseViz(user, 'Bar')
    await user.click(screen.getByRole('button', { name: 'Run' }))

    // Named for the shape that was picked, not the generic "Chart" the type
    // registry calls it.
    await screen.findByRole('tab', { name: 'Bar' })
    expect(resultTabs()).toEqual(['Bar', 'Table'])
    expect(screen.getByRole('tab', { name: 'Bar' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(/Failed to render visualization/i)).not.toBeInTheDocument()
  })

  it('shows the table alone when Table is the picked type', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    // Table is the default, so this is the untouched picker. It must not add a
    // second tab that also says Table.
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText(/Query executed successfully/i)).toBeInTheDocument()

    expect(resultTabs()).toEqual(['Table'])
  })

  it('keeps a picked chart off a run the analyst started in PRO', async () => {
    const user = userEvent.setup()
    await openVisualMode(user)

    await chooseViz(user, 'Heatmap')
    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByRole('tab', { name: 'Heatmap' })).toBeInTheDocument()

    // PRO's Execute is a different run, of whatever is in the buffer. The chart
    // belonged to the composition that was left behind, so it does not follow.
    await user.click(screen.getByRole('tab', { name: 'SQL Editor' }))
    await user.click(await screen.findByRole('button', { name: 'Run' }))

    expect(await screen.findByText(/Query executed successfully/i)).toBeInTheDocument()
    expect(resultTabs()).toEqual(['Table'])
  })
})
