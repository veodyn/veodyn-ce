// An empty catalog must not strand the analyst in Visual mode: the notice tells
// them to continue in PRO, so getting to PRO has to work from here.
//
// This used to be guarded by a confirmation panel the pane rendered itself,
// because with no datasets there was no VisualBuilder to host the one the
// builder normally showed. The panel is gone and the top PRO tab switches
// directly, so what needs pinning is that the direct switch still completes
// when the pane has nothing to build over.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDataSources, mockDatasets } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders } from '@/test/utils'
import { QueryVisualPane } from './query-visual-pane'

function seedEmptyCatalog() {
  useMockDataStore.setState({ datasets: [] })
}

function restoreCatalog() {
  useMockDataStore.setState({ datasets: [...mockDatasets] })
}

// Mirrors the query-editor-page wiring: the top PRO tab hands the current
// buffer straight to PRO and leaves Visual mode.
function PaneHarness({ onSwitchToPro }: { onSwitchToPro: (sql: string) => void }) {
  const [mode, setMode] = useState<'visual' | 'pro'>('visual')

  function handleSwitchToPro(sql: string) {
    setMode('pro')
    onSwitchToPro(sql)
  }

  const visualMode = mode === 'visual'

  return (
    <div>
      <button type="button" onClick={() => handleSwitchToPro('')}>
        Top PRO tab
      </button>
      <p data-testid="page-state">{mode}</p>
      {visualMode ? (
        <QueryVisualPane
          datasetId={null}
          onDatasetIdChange={() => {}}
          dataSources={mockDataSources}
          dataSourceId={1}
          onDataSourceIdChange={() => {}}
          onCompile={() => {}}
          onSwitchToPro={handleSwitchToPro}
        />
      ) : (
        <div>PRO editor</div>
      )}
    </div>
  )
}

describe('QueryVisualPane empty-catalog PRO handoff', () => {
  beforeEach(seedEmptyCatalog)
  afterEach(restoreCatalog)

  it('reaches PRO in one click when no dataset is valid', async () => {
    const user = userEvent.setup()
    const onSwitchToPro = vi.fn()
    renderWithProviders(<PaneHarness onSwitchToPro={onSwitchToPro} />)

    // No datasets: the builder never mounts, only the empty-catalog notice.
    expect(await screen.findByText(/no datasets to build over/i)).toBeInTheDocument()
    expect(screen.getByTestId('page-state')).toHaveTextContent('visual')

    await user.click(screen.getByRole('button', { name: 'Top PRO tab' }))

    // The switch completes: PRO is reached with nothing to dismiss on the way.
    expect(onSwitchToPro).toHaveBeenCalledWith('')
    expect(screen.getByTestId('page-state')).toHaveTextContent('pro')
    expect(screen.getByText('PRO editor')).toBeInTheDocument()
  })

  it('renders no confirmation panel of its own', async () => {
    renderWithProviders(<PaneHarness onSwitchToPro={vi.fn()} />)

    await screen.findByText(/no datasets to build over/i)

    expect(screen.queryByText(/open this query in pro\?/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open in pro and lock/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /keep editing visually/i })).not.toBeInTheDocument()
  })
})
