import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import {
  chooseOption,
  chooseViz,
  composedSql,
  restoreDatasets,
  seedDatasets,
} from './visual-builder-test-fixtures'
import { VisualBuilder } from './visual-builder'
import { emptyVisualDraft } from './visual-builder-model'

describe('VisualBuilder', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  function renderBuilder(datasetId = 'trips-daily') {
    const onCompile = vi.fn()
    const onSwitchToPro = vi.fn()
    renderWithProviders(
      <VisualBuilder datasetId={datasetId} onCompile={onCompile} onSwitchToPro={onSwitchToPro} />
    )
    return { onCompile, onSwitchToPro }
  }

  it('derives dimension, measure, filter, sort, limit and chart controls from the schema', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    // Non-numeric columns are the dimensions; numeric ones are not offered there.
    expect(await screen.findByRole('button', { name: 'line' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'service_date' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'trips' })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Add measure' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add sort' })).toBeEnabled()
    expect(screen.getByLabelText('Row limit')).toHaveValue(100)

    // How to draw the answer is a group of picture tiles rather than a select of
    // type names, and it starts on the plainest of them.
    expect(screen.getByRole('radiogroup', { name: 'Visualization type' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked()
    expect(await composedSql(user, onCompile)).toBe('SELECT *\nFROM trips_daily\nLIMIT 100')
  })

  // The card asks two questions, and it used to run them together in one column
  // with the visualization choice as a select at the bottom.
  it('separates what to fetch from how to show it', async () => {
    renderBuilder()

    const data = await screen.findByRole('region', { name: 'Data' })
    const visualization = screen.getByRole('region', { name: 'Visualization' })

    // Row limit is how much to fetch, so it belongs with the fields, not beside
    // the picker where it used to sit.
    expect(data).toContainElement(screen.getByLabelText('Row limit'))
    expect(data).toContainElement(screen.getByRole('button', { name: 'Add measure' }))
    expect(visualization).toContainElement(screen.getByRole('radio', { name: 'Table' }))

    // The composed SQL is no longer shown: Run and the SQL editor are where the
    // query leaves, and a read-only copy of it was furniture in between.
    expect(screen.queryByRole('region', { name: 'Generated SQL' })).not.toBeInTheDocument()
  })

  // A draft can outlive the build that wrote it. The run already answers a
  // stale visualization id with the table; the picker has to say the same thing
  // rather than showing nothing checked at all.
  it('falls back to the table when the draft names a visualization it no longer offers', async () => {
    renderWithProviders(
      <VisualBuilder
        datasetId="trips-daily"
        onCompile={() => {}}
        onSwitchToPro={() => {}}
        draft={{ ...emptyVisualDraft(), vizId: 'no-such-choice' }}
        onDraftChange={() => {}}
      />
    )

    expect(await screen.findByRole('radio', { name: 'Table' })).toBeChecked()
  })

  it('shows a picked dimension as picked, in more than a tint', async () => {
    // The chips ARE the SELECT list, so which are on is the main thing this
    // section says. The on state used to be `secondary`: #F0EDE6 against a
    // #F7F5F0 background, a step small enough to read as "nothing is
    // selected" next to compiled SQL that said otherwise. `--muted` is that
    // same #F0EDE6, so an unselected chip under the cursor looked selected.
    const user = userEvent.setup()
    renderBuilder()

    const chip = await screen.findByRole('button', { name: 'line' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    const unpicked = chip.className

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    // Inverted, not tinted: the fill is the primary token and the text flips
    // with it, which survives grayscale and any colour vision.
    expect(chip).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(chip.className).not.toBe(unpicked)
    expect(chip).not.toHaveClass('bg-secondary')
  })

  it('compiles the picked dimension and measure and hands them to onCompile', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'line' }))
    expect(screen.getByRole('button', { name: 'line' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Add measure' }))

    const expected =
      'SELECT line, sum(trips) AS sum_trips\nFROM trips_daily\nGROUP BY line\nLIMIT 100'

    await user.click(screen.getByRole('button', { name: 'Run' }))
    expect(onCompile).toHaveBeenCalledWith(expected, {
      type: 'TABLE',
      name: 'Table',
      options: {},
    })
  })

  it('escapes a filter value into a literal instead of concatenating it', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    await chooseOption(user, 'Filter 1 column', 'line')
    await user.type(screen.getByLabelText('Filter 1 value'), "Red' OR 1=1")

    expect(await composedSql(user, onCompile)).toBe(
      "SELECT *\nFROM trips_daily\nWHERE line = 'Red'' OR 1=1'\nLIMIT 100"
    )
  })

  it('renders numeric-friendly filter value inputs in mono tabular figures', async () => {
    const user = userEvent.setup()
    renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add filter' }))
    const valueInput = screen.getByLabelText('Filter 1 value')
    expect(valueInput).toHaveClass('font-mono', 'tabular-nums')
  })

  it('sorts by an aggregate alias and applies the chosen chart type and limit', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'line' }))
    await user.click(screen.getByRole('button', { name: 'Add measure' }))
    await user.click(screen.getByRole('button', { name: 'Add sort' }))
    await chooseOption(user, 'Sort 1 column', 'sum_trips')
    await chooseOption(user, 'Sort 1 direction', 'Descending')
    await chooseViz(user, 'Bar')

    const limit = screen.getByLabelText('Row limit')
    await user.clear(limit)
    await user.type(limit, '25')

    const expected =
      'SELECT line, sum(trips) AS sum_trips\nFROM trips_daily\nGROUP BY line\nORDER BY sum_trips desc\nLIMIT 25'

    await user.click(screen.getByRole('button', { name: 'Run' }))
    // Bar is a CHART carrying the shape as an option, not a type of its own.
    expect(onCompile).toHaveBeenCalledWith(expected, {
      type: 'CHART',
      name: 'Bar',
      options: { globalSeriesType: 'bar' },
    })
  })

  it('removes a measure row through its named control', async () => {
    const user = userEvent.setup()
    const { onCompile } = renderBuilder()

    await user.click(await screen.findByRole('button', { name: 'Add measure' }))
    expect(await composedSql(user, onCompile)).toContain('sum(trips) AS sum_trips')

    await user.click(screen.getByRole('button', { name: 'Remove measure 1' }))
    expect(await composedSql(user, onCompile)).toBe('SELECT *\nFROM trips_daily\nLIMIT 100')
  })

  it('reports a dataset that is not in the catalog instead of rendering controls', async () => {
    renderBuilder('not-a-dataset')

    expect(await screen.findByText(/dataset was not found/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run' })).not.toBeInTheDocument()
  })
})
