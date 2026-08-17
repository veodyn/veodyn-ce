// Tagging on the dataset detail page. A dataset has no owner to check against,
// so the gate is only "signed in": curating shared warehouse tables is a
// wiki-like surface. Split from page.test.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { useAuthStore } from '@/stores/auth-store'
import type { CurrentUser } from '@/stores/auth-identity'
import type { Dataset } from '@/types/catalog'
import * as tagsService from '@/services/tags/client'
import DatasetDetailPage from './page'

// The whole tag client is stubbed: the vocabulary read is what tells the page
// the backend is configured at all, and putObjectTags is the assertion target.
// The real module is spread back in so `tagErrorCause` and `TagErrorCause`
// survive the stub; the failure path reads both as soon as a write is refused.
vi.mock('@/services/tags/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tags/client')>()),
  fetchTagVocabulary: vi.fn(async () => []),
  fetchRedashTagVocabulary: vi.fn(async () => []),
  putObjectTags: vi.fn(async (_type: string, _id: string, tags: string[]) => tags),
}))

const DATASET_ID = 'rail-ridership'

function makeDataset(tags: string[]): Dataset {
  return {
    id: DATASET_ID,
    name: 'Rail Ridership',
    description: 'Daily boardings by line.',
    domain: 'transit',
    schema: [],
    freshness: { lastUpdatedAt: '2026-07-20T00:00:00Z', status: 'fresh' },
    coverage: { start: '2026-01-01T00:00:00Z', end: '2026-07-20T00:00:00Z' },
    rowCount: 10,
    sources: [],
    tags,
    sampleQueryId: null,
    origin: 'capture',
    writable: false,
  }
}

function seed(tags: string[]) {
  useMockDataStore.setState({ datasets: [makeDataset(tags)] })
}

function signIn() {
  useAuthStore.setState({
    currentUser: { id: 7, name: 'Signed in', isAdmin: false } as CurrentUser,
  })
}

async function renderPage() {
  await act(async () => {
    renderWithProviders(<DatasetDetailPage params={Promise.resolve({ datasetId: DATASET_ID })} />)
  })
}

afterEach(() => {
  vi.mocked(tagsService.putObjectTags).mockClear()
  resetStores()
})

async function addTag(text: string) {
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /add tag/i }))
  const input = await screen.findByRole('combobox', { name: /add a tag/i })
  await user.type(input, `${text}{Enter}`)
}

describe('dataset detail tagging', () => {
  it('writes the whole new array to the dataset object type', async () => {
    signIn()
    seed(['rail'])
    await renderPage()

    await addTag('ridership')

    await waitFor(() => expect(tagsService.putObjectTags).toHaveBeenCalledTimes(1))
    expect(tagsService.putObjectTags).toHaveBeenCalledWith('dataset', DATASET_ID, [
      'rail',
      'ridership',
    ])
  })

  it('carries a domain tag through unchanged when an unrelated tag is added', async () => {
    signIn()
    seed(['domain:transit', 'rail'])
    await renderPage()

    expect(screen.queryByText('domain:transit')).not.toBeInTheDocument()

    await addTag('ridership')

    await waitFor(() => expect(tagsService.putObjectTags).toHaveBeenCalledTimes(1))
    expect(tagsService.putObjectTags).toHaveBeenCalledWith('dataset', DATASET_ID, [
      'domain:transit',
      'rail',
      'ridership',
    ])
  })

  it('offers no editing affordance when nobody is signed in', async () => {
    useAuthStore.setState({ currentUser: null })
    seed(['rail'])
    await renderPage()

    expect(await screen.findByText('rail')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add tag/i })).not.toBeInTheDocument()
  })
})
