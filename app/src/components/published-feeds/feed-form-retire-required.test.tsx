import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { EntityNeeds, FeedCapabilities, PublishedFeed } from '@/types/published-feed'

const registry = vi.hoisted(() => ({ answer: undefined as unknown }))

vi.mock('@/hooks/use-published-feeds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-published-feeds')>()
  return {
    ...actual,
    useFeedCapabilities: () => ({ data: registry.answer, isLoading: false, isError: false }),
  }
})

const { FeedForm } = await import('./feed-form')

const REF = 'https://example.org/downtown/gtfs-2026-08-01.zip'

const MUST_RETIRE: EntityNeeds = {
  query: false,
  staticReference: true,
  columnMap: false,
  retirementOnFailure: true,
}

const MAY_RETAIN: EntityNeeds = {
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

function aBoundFeed(): PublishedFeed {
  return {
    slug: 'downtown',
    revision: 1,
    queryId: null,
    standard: 'gtfs-rt',
    version: '2.0',
    entity: 'bulletins',
    staticGtfsRef: REF,
    systemInfo: null,
    sourceColumn: null,
    columnMap: {},
    onError: 'block',
    lastGoodMaxAgeSeconds: null,
    retireOnFailure: true,
    visibility: 'private',
    bindingState: 'unknown',
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

function theSwitch() {
  return screen.getByRole('switch', { name: /retire the served artifact/i })
}

beforeEach(() => {
  resetStores()
  useMockDataStore.setState({ publishedFeeds: [aBoundFeed()] })
  registry.answer = deploymentRegistering({ bulletins: MUST_RETIRE })
})

afterEach(() => resetStores())

describe('an entity that cannot serve a retained artifact', () => {
  it('starts with retirement on rather than leaving the operator to find out at rebuild time', () => {
    renderCreateForm()

    expect(theSwitch()).toBeChecked()
  })

  it('argues for the choice this entity needs, not for a vehicle feed', () => {
    renderCreateForm()

    expect(screen.queryByText(/vehicle-position feed/i)).not.toBeInTheDocument()
    expect(screen.getByText(/since been withdrawn/i)).toBeInTheDocument()
  })

  it('refuses a binding the rebuild would reject, before it posts', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await user.click(theSwitch())
    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'downtown-two')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /cannot be published with the served artifact retained/i
    )
  })

  it('refuses last known good for it too, since that mode retains by design', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await user.click(screen.getByRole('radio', { name: /last known good/i }))
    await user.type(screen.getByLabelText(/maximum age/i), '300')
    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'downtown-two')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      /cannot be published with the served artifact retained/i
    )
  })

  it('marks the retire switch required, since this entity accepts no other answer', () => {
    renderCreateForm()

    expect(theSwitch()).toHaveAttribute('aria-required', 'true')
    expect(
      screen.getByText('Retire the served artifact when a publish fails').querySelector(
        '[data-slot="required-marker"]'
      )
    ).not.toBeNull()
  })

  it('publishes once the binding is one the rebuild will accept', async () => {
    const user = userEvent.setup()
    const onSubmit = renderCreateForm()

    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'downtown-two')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ onError: 'block', retireOnFailure: true, staticGtfsRef: REF })
    )
  })
})

describe('an entity that declares nothing about a retained artifact', () => {
  it('keeps the behaviour community shipped: retirement off, and the binding accepted', async () => {
    const user = userEvent.setup()
    registry.answer = deploymentRegistering({ bulletins: MAY_RETAIN })
    const onSubmit = renderCreateForm()

    expect(theSwitch()).not.toBeChecked()

    await user.type(screen.getByRole('textbox', { name: 'Slug' }), 'downtown-two')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ retireOnFailure: false }))
  })

  it('leaves the retire switch unmarked, since either answer is accepted here', () => {
    registry.answer = deploymentRegistering({ bulletins: MAY_RETAIN })
    renderCreateForm()

    expect(theSwitch()).not.toHaveAttribute('aria-required')
    expect(
      screen.getByText('Retire the served artifact when a publish fails').querySelector(
        '[data-slot="required-marker"]'
      )
    ).toBeNull()
  })
})
