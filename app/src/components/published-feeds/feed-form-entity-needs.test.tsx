import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { EntityNeeds, FeedCapabilities } from '@/types/published-feed'

const registry = vi.hoisted(() => ({ answer: undefined as unknown }))

vi.mock('@/hooks/use-published-feeds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-published-feeds')>()
  return {
    ...actual,
    useFeedCapabilities: () => ({ data: registry.answer, isLoading: false, isError: false }),
  }
})

const { FeedForm } = await import('./feed-form')

const QUERY_BACKED: EntityNeeds = { query: true, staticReference: true, columnMap: true }

// No community build registers this entity, and that is the point: a test that
// used a real name would pass for a form that hardcodes the name rather than
// one that reads the registry.
const BULLETINS: EntityNeeds = { query: false, staticReference: true, columnMap: false }

function deploymentRegistering(entityNeeds: Record<string, EntityNeeds>): FeedCapabilities {
  return {
    standards: [
      {
        standard: 'gtfs-rt',
        versions: ['2.0'],
        entities: Object.keys(entityNeeds).sort(),
        entityNeeds,
        timezones: [],
      },
    ],
  }
}

function renderCreateForm() {
  const onSubmit = vi.fn()
  renderWithProviders(
    <FeedForm
      submitLabel="Publish"
      isPending={false}
      error={null}
      fieldErrors={{}}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  )
  return onSubmit
}

beforeEach(() => {
  registry.answer = deploymentRegistering({ bulletins: BULLETINS })
})

afterEach(() => resetStores())

describe('a form for an entity whose producer needs no query', () => {
  it('does not ask for a source query at all', () => {
    renderCreateForm()

    expect(screen.queryByText('Source')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/source query/i)).not.toBeInTheDocument()
  })

  it('does not ask for a column map, rather than showing an empty one', () => {
    renderCreateForm()

    expect(screen.queryByText('vehicle_id')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('submits a null queryId rather than a plausible-looking stand-in id', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await user.type(screen.getByLabelText('Slug'), 'bulletins')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const sent = onSubmit.mock.calls[0][0]
    // Named rather than matched loosely: 0 is the value this form used to send,
    // and `toBeFalsy` would accept it.
    expect(sent.queryId).toBeNull()
    expect(sent.entity).toBe('bulletins')
    expect(sent.columnMap).toEqual({})
  })

  it('still refuses the halves its producer does consume', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({ publishedFeeds: [] })
    const onSubmit = renderCreateForm()

    await user.type(screen.getByLabelText('Slug'), 'bulletins')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/static GTFS reference is required/i)).toBeInTheDocument()
  })
})

describe('a form for an entity whose producer needs no static schedule', () => {
  it('does not ask for one, and the whole mapping section goes with it', () => {
    registry.answer = deploymentRegistering({
      bulletins: { query: false, staticReference: false, columnMap: false },
    })

    renderCreateForm()

    expect(screen.queryByLabelText(/static gtfs reference/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Mapping')).not.toBeInTheDocument()
  })
})

describe('the form follows the entity, not the standard', () => {
  it('brings the source, the static reference and the map back when the entity changes', async () => {
    // Both entities are gtfs-rt at 2.0, so the standard cannot be what decides
    // which sections render: read from the standard, the queryless one above
    // would show every section too.
    const user = userEvent.setup()
    registry.answer = deploymentRegistering({
      bulletins: BULLETINS,
      vehicle_positions: QUERY_BACKED,
    })

    renderCreateForm()

    expect(screen.queryByText('Source')).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /entity/i }))
    await user.click(await screen.findByRole('option', { name: 'vehicle_positions' }))

    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByLabelText('Static GTFS reference')).toBeInTheDocument()
    // The map is a row of prose until a query is picked, so the table itself is
    // what says the section is being asked for.
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('when the capabilities read has not answered', () => {
  it('asks for everything a community entity needs rather than for nothing', () => {
    registry.answer = undefined

    renderCreateForm()

    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByLabelText('Static GTFS reference')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
