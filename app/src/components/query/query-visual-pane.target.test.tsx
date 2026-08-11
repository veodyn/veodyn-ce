// The builder composes SQL and only SQL, but the query is executed against
// whichever data source the query is on, and plenty of them speak something
// else: the regional runners take a JSON endpoint descriptor. Running Visual picks
// against one of those used to reach the backend and come back as "Invalid
// query JSON: Expecting value: line 1 column 1 (char 0)", which reads like a
// bug in the query rather than a query aimed at the wrong kind of source.
//
// It is said in a hint under the picker and a title on Run, not a banner.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import {
  chooseOption,
  jsonSource,
  restoreDatasets,
  seedDatasets,
  sqlSource,
} from './visual-builder-test-fixtures'
import { QueryVisualPane } from './query-visual-pane'

const WAREHOUSE = sqlSource(1, 'Warehouse')
const OPS = sqlSource(2, 'Operational')
const REALTIME = jsonSource(3, 'Realtime API')
const SOURCES = [WAREHOUSE, OPS, REALTIME]

function TargetHarness({ startOn, onCompile }: { startOn: number; onCompile?: () => void }) {
  const [dataSourceId, setDataSourceId] = useState(startOn)

  return (
    <QueryVisualPane
      datasetId="trips-daily"
      onDatasetIdChange={() => {}}
      dataSources={SOURCES}
      dataSourceId={dataSourceId}
      onDataSourceIdChange={setDataSourceId}
      onCompile={onCompile ?? (() => {})}
      onSwitchToPro={() => {}}
    />
  )
}

describe('QueryVisualPane data source targeting', () => {
  beforeEach(seedDatasets)
  afterEach(restoreDatasets)

  it('refuses to Run against a source that does not take SQL, and says which', async () => {
    renderWithProviders(<TargetHarness startOn={REALTIME.id} />)

    const run = await screen.findByRole('button', { name: 'Run' })
    expect(run).toBeDisabled()
    // The reason rides on the dead control and under the picker that chose it.
    // No banner: a disabled button does not need a paragraph over the top of it.
    expect(run).toHaveAttribute('title', 'Realtime API takes json, not SQL, so Run is off here.')
    expect(screen.getByText('Takes json, not SQL. Run is off.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    // Not a dead end: PRO is where this source's own query language is written.
    expect(screen.getByRole('button', { name: 'Open in SQL Editor' })).toBeEnabled()
  })

  it('offers only SQL sources, plus whichever one is already selected', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TargetHarness startOn={REALTIME.id} />)

    await user.click(await screen.findByRole('combobox', { name: 'Data source' }))
    // Awaited, then read: the Select mounts its options into a portal, so a
    // synchronous getAllByRole here races the open and finds an empty list
    // under load. Once one option is up the rest are, so the list itself is
    // still read in one go.
    await screen.findByRole('option', { name: WAREHOUSE.name })
    const offered = screen.getAllByRole('option').map((option) => option.textContent)

    // The selected one stays listed or the trigger would have a value it cannot
    // name. Nothing else that refuses SQL is offered at all.
    expect(offered).toEqual(['Warehouse', 'Operational', 'Realtime API'])
  })

  it('lifts the block the moment a SQL source is picked', async () => {
    const user = userEvent.setup()
    const onCompile = vi.fn()
    renderWithProviders(<TargetHarness startOn={REALTIME.id} onCompile={onCompile} />)

    await screen.findByText('Takes json, not SQL. Run is off.')
    await chooseOption(user, 'Data source', 'Warehouse')

    expect(screen.queryByText(/not SQL/)).not.toBeInTheDocument()
    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()

    await user.click(run)
    expect(onCompile).toHaveBeenCalledOnce()
  })

  it('says nothing when the source speaks SQL', async () => {
    renderWithProviders(<TargetHarness startOn={WAREHOUSE.id} />)

    await screen.findByRole('region', { name: 'Visualization' })
    expect(screen.queryByText(/not SQL/)).not.toBeInTheDocument()
    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeEnabled()
    expect(run).not.toHaveAttribute('title')
  })
})
