// Which data source a NEW query starts on.
//
// The page used to open every new query on a literal `1`, which is an id, not a
// default. Whether that id can run SQL at all depends on the order rows went
// into someone's database. On the dev instance id 1 is a regional feed that takes
// a JSON endpoint descriptor, so the builder composed SQL over a warehouse
// table, Run sent it there, and Redash answered
//
//     Invalid query JSON: Expecting value: line 1 column 1 (char 0)
//
// about a query that was perfectly well formed. The sibling suite
// (query-visual-pane.target.test.tsx) covers what the pane does once a query IS
// pointed at such a source; this one covers never starting there.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useMockDataStore } from '@/stores/mock-data-store'
import { resetStores } from '@/test/utils'
import {
  jsonSource,
  restoreDatasets,
  seedDatasets,
  sqlSource,
} from './visual-builder-test-fixtures'
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

const original = useMockDataStore.getState().dataSources

beforeEach(seedDatasets)
afterEach(() => {
  useMockDataStore.setState({ dataSources: original })
  restoreDatasets()
  resetStores()
})

async function openVisualMode(dataSources: ReturnType<typeof sqlSource>[]) {
  useMockDataStore.setState({ dataSources })
  const user = userEvent.setup()
  renderQueryEditorPage({ aiEnabled: true })
  await user.click(await screen.findByRole('tab', { name: 'Visual' }))
}

describe('the data source a new query starts on', () => {
  it('is one that takes SQL, not whichever one happens to be id 1', async () => {
    // Ordered the way the dev instance is: thirteen regional feeds were created
    // first, so the warehouse that can actually run SQL is nowhere near id 1.
    await openVisualMode([jsonSource(1, 'Regional MetroCloudAlliance'), sqlSource(14, 'DE Historical')])

    expect(await screen.findByRole('combobox', { name: 'Data source' })).toHaveTextContent(
      'DE Historical'
    )
    expect(screen.queryByText(/Run is off/)).not.toBeInTheDocument()
  })

  it('falls back to the first source when none of them takes SQL', async () => {
    await openVisualMode([jsonSource(1, 'Regional MetroCloudAlliance'), jsonSource(2, 'Regional Waze')])

    // Nothing to prefer, so the picker names what it is pointed at rather than
    // sitting empty on a value it cannot label, and Run says why it is off.
    expect(await screen.findByRole('combobox', { name: 'Data source' })).toHaveTextContent(
      'Regional MetroCloudAlliance'
    )
    expect(screen.getByText(/Run is off/)).toBeInTheDocument()
  })

  it('never shows a raw id while the source list is still arriving', async () => {
    // base-ui prints the raw value when it has no label for it, and the list
    // is async, so for one render the picker read "0" on the deployed dev
    // instance. A sentinel is for the code, not for the analyst.
    useMockDataStore.setState({ dataSources: [] })
    renderQueryEditorPage({ aiEnabled: true })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: 'Visual' }))

    const picker = await screen.findByRole('combobox', { name: 'Data source' })
    expect(picker).toHaveTextContent('Select')
    expect(picker).not.toHaveTextContent('0')
  })

  it('asks for no schema until it knows which source to ask about', async () => {
    // The unresolved value is 0, and 0 is not a Redash id. Passing it through
    // would send the backend to /data_sources/0/schema on every new query.
    const schemaRequests: string[] = []
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/schema')) schemaRequests.push(url)
      return Promise.reject(new Error('not routed in this test'))
    })

    await openVisualMode([jsonSource(1, 'Regional MetroCloudAlliance'), sqlSource(14, 'DE Historical')])

    expect(schemaRequests.filter((url) => url.includes('data_sources/0'))).toEqual([])
    fetchSpy.mockRestore()
  })
})
