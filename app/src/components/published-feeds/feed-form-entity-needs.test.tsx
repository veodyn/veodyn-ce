import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import { pickAStaticReference } from './feed-form.test-helpers'
import type { EntityNeeds, FeedCapabilities } from '@/types/published-feed'

const registry = vi.hoisted(() => ({ answer: undefined as unknown, loading: false }))

vi.mock('@/hooks/use-published-feeds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-published-feeds')>()
  return {
    ...actual,
    useFeedCapabilities: () => ({
      data: registry.loading ? undefined : registry.answer,
      isLoading: registry.loading,
      isError: false,
    }),
  }
})

const { FeedForm } = await import('./feed-form')

const QUERY_BACKED: EntityNeeds = {
  query: true,
  staticReference: true,
  columnMap: true,
  retirementOnFailure: false,
}

const BULLETINS: EntityNeeds = {
  query: false,
  staticReference: true,
  columnMap: false,
  retirementOnFailure: false,
}

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

function renderCreateForm({
  defaultEntity,
  error = null,
}: { defaultEntity?: string; error?: string | null } = {}) {
  const onSubmit = vi.fn()
  renderWithProviders(
    <FeedForm
      defaultEntity={defaultEntity}
      submitLabel="Publish"
      isPending={false}
      error={error}
      fieldErrors={{}}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  )
  return onSubmit
}

beforeEach(() => {
  registry.answer = deploymentRegistering({ bulletins: BULLETINS })
  registry.loading = false
})

describe('a create form opened on an asked-for entity', () => {
  it('offers nothing to touch until the registry that decides its standard has answered', () => {
    registry.loading = true

    renderCreateForm({ defaultEntity: 'vehicles' })

    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Slug' })).not.toBeInTheDocument()
  })
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

    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'bulletins')
    await pickAStaticReference(user)
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const sent = onSubmit.mock.calls[0][0]
    expect(sent.queryId).toBeNull()
    expect(sent.entity).toBe('bulletins')
    expect(sent.columnMap).toEqual({})
  })

  it('still refuses the halves its producer does consume', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({ publishedFeeds: [] })
    const onSubmit = renderCreateForm()

    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'bulletins')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/static GTFS reference is required/i)).toBeInTheDocument()
  })
})

describe('a form for an entity whose producer needs no static schedule', () => {
  it('does not ask for one, and the whole mapping section goes with it', () => {
    registry.answer = deploymentRegistering({
      bulletins: { query: false, staticReference: false, columnMap: false, retirementOnFailure: false },
    })

    renderCreateForm()

    expect(screen.queryByLabelText(/static gtfs reference/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Mapping')).not.toBeInTheDocument()
  })
})

describe('the form follows the entity, not the standard', () => {
  it('brings the source, the static reference and the map back when the entity changes', async () => {
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
    expect(screen.getByText('Static GTFS reference')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('what stands where the source section would be', () => {
  it('says a queryless feed serves what is published to it, rather than leaving a gap', () => {
    renderCreateForm()

    expect(screen.queryByText('Source')).not.toBeInTheDocument()
    expect(screen.getByText(/no source query/i)).toBeInTheDocument()
  })

  it('drops a refusal about the source once the entity no longer has one', async () => {
    const user = userEvent.setup()
    registry.answer = deploymentRegistering({
      bulletins: BULLETINS,
      vehicle_positions: QUERY_BACKED,
    })
    renderCreateForm()

    await user.click(screen.getByRole('combobox', { name: /entity/i }))
    await user.click(await screen.findByRole('option', { name: 'vehicle_positions' }))
    await user.click(screen.getByRole('button', { name: 'Publish' }))
    expect(screen.getByText(/pick a source query/i)).toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /entity/i }))
    await user.click(await screen.findByRole('option', { name: 'bulletins' }))

    expect(screen.queryByText(/pick a source query/i)).not.toBeInTheDocument()
  })
})

describe('a refusal the server sent back', () => {
  it('stays on screen beside a refusal the form finds on its own', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({ publishedFeeds: [] })
    renderCreateForm({ error: 'Could not publish this feed.' })

    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'bulletins')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(screen.getByText(/static GTFS reference is required/i)).toBeInTheDocument()
    expect(screen.getByText('Could not publish this feed.')).toBeInTheDocument()
  })
})

describe('the entity a create form is opened on', () => {
  it('starts on the entity the caller asked for when the registry offers it', () => {
    registry.answer = deploymentRegistering({
      bulletins: BULLETINS,
      vehicle_positions: QUERY_BACKED,
    })

    renderCreateForm({ defaultEntity: 'vehicle_positions' })

    expect(screen.getByRole('combobox', { name: /entity/i })).toHaveTextContent('vehicle_positions')
    expect(screen.getByText('Source')).toBeInTheDocument()
  })

  it('follows the asked-for entity to the standard that registers it', () => {
    registry.answer = {
      standards: [
        ...deploymentRegistering({ vehicle_positions: QUERY_BACKED }).standards,
        {
          standard: 'gbfs',
          versions: ['2.3'],
          entities: ['stations', 'vehicles'],
          entityNeeds: {
            stations: { query: true, staticReference: false, columnMap: true, retirementOnFailure: false },
            vehicles: { query: true, staticReference: false, columnMap: true, retirementOnFailure: false },
          },
          timezones: [],
        },
      ],
    }

    renderCreateForm({ defaultEntity: 'vehicles' })

    expect(screen.getByRole('combobox', { name: /standard/i })).toHaveTextContent(/gbfs/i)
    expect(screen.getByRole('combobox', { name: /entity/i })).toHaveTextContent('vehicles')
  })

  it('ignores an asked-for entity the registry does not offer', () => {
    registry.answer = deploymentRegistering({
      bulletins: BULLETINS,
      vehicle_positions: QUERY_BACKED,
    })

    renderCreateForm({ defaultEntity: 'trip_updates' })

    expect(screen.getByRole('combobox', { name: /entity/i })).toHaveTextContent('bulletins')
  })
})

describe('when the capabilities read has not answered', () => {
  it('asks for everything a community entity needs rather than for nothing', () => {
    registry.answer = undefined

    renderCreateForm()

    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText('Static GTFS reference')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
