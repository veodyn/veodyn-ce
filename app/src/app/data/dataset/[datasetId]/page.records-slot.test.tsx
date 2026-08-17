// The dataset.records seam on the dataset detail page. A separate file from
// page.test.tsx, the same reasoning as feed-address.slot.test.tsx: this mocks
// the registry at module scope, so it needs its own file rather than changing
// what every other case in page.test.tsx renders against.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { Dataset } from '@/types/catalog'
import type { FeatureDescriptor } from '@/features/types'
import DatasetDetailPage from './page'

const DATASET_ID = 'rail-ridership'

const DATASET: Dataset = {
  id: DATASET_ID,
  name: 'Rail Ridership',
  description: 'Daily boardings by line.',
  domain: 'transit',
  schema: [],
  freshness: { lastUpdatedAt: '2026-07-20T00:00:00Z', status: 'fresh' },
  coverage: { start: '2026-01-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
  rowCount: 10,
  sources: [],
  tags: [],
  sampleQueryId: null,
  origin: 'contributed',
  writable: true,
}

/** Whatever a feature puts in the dataset.records slot, standing in for it. */
function RecordEditorStub({ dataset }: { dataset: Dataset }) {
  return <p>Type a record for {dataset.id}</p>
}

vi.mock('@/features/generated-registry', () => {
  const FEATURES: Record<string, FeatureDescriptor> = {
    'managed-datasets': {
      id: 'managed-datasets',
      nav: [],
      routes: [],
      slots: { 'dataset.records': async () => ({ default: RecordEditorStub }) },
    },
  }
  return { FEATURES }
})

async function renderPage() {
  await act(async () => {
    renderWithProviders(<DatasetDetailPage params={Promise.resolve({ datasetId: DATASET_ID })} />)
  })
}

afterEach(() => {
  resetStores()
})

describe('the dataset.records slot', () => {
  it('renders the contributed record editor, with the dataset itself', async () => {
    useMockDataStore.setState({ datasets: [DATASET] })

    await renderPage()

    expect(await screen.findByText('Type a record for rail-ridership')).toBeInTheDocument()
  })
})
