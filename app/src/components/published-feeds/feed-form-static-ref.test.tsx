import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import type { FeedCapabilities, PublishedFeed } from '@/types/published-feed'

const SCHEDULE_ONLY = vi.hoisted<FeedCapabilities>(() => ({
  standards: [
    {
      standard: 'gtfs-rt',
      versions: ['2.0'],
      entities: ['bulletins'],
      entityNeeds: {
        bulletins: {
          query: false,
          staticReference: true,
          columnMap: false,
          retirementOnFailure: false,
        },
      },
      timezones: [],
    },
  ],
}))

vi.mock('@/hooks/use-published-feeds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-published-feeds')>()
  return {
    ...actual,
    useFeedCapabilities: () => ({ data: SCHEDULE_ONLY, isLoading: false, isError: false }),
  }
})

const { FeedForm } = await import('./feed-form')

const DOWNTOWN = 'https://example.org/downtown/gtfs-2026-08-01.zip'
const HARBOR = 'https://example.org/harbor/gtfs-2026-07-15.zip'
const RETIRED = 'https://example.org/retired/gtfs-2019-01-01.zip'

function aFeed(slug: string, staticGtfsRef: string | null): PublishedFeed {
  return {
    slug,
    revision: 1,
    queryId: null,
    standard: staticGtfsRef === null ? 'gbfs' : 'gtfs-rt',
    version: staticGtfsRef === null ? '2.3' : '2.0',
    entity: staticGtfsRef === null ? 'stations' : 'bulletins',
    staticGtfsRef,
    systemInfo: staticGtfsRef === null ? {} : null,
    sourceColumn: null,
    columnMap: {},
    onError: 'block',
    lastGoodMaxAgeSeconds: null,
    retireOnFailure: false,
    visibility: 'private',
    bindingState: 'unknown',
  }
}

function boundOn(feeds: PublishedFeed[]) {
  useMockDataStore.setState({ publishedFeeds: feeds })
}

function renderForm(initial?: PublishedFeed) {
  const onSubmit = vi.fn()
  renderWithProviders(
    <FeedForm
      initial={initial}
      slugLocked={initial != null}
      submitLabel={initial ? 'Save' : 'Publish'}
      isPending={false}
      error={null}
      fieldErrors={{}}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />
  )
  return onSubmit
}

function theReferencePicker() {
  return screen.findByRole('combobox', { name: /static gtfs reference/i })
}

function theEscape() {
  return screen.findByRole('button', { name: /enter a different reference/i })
}

beforeEach(() => resetStores())
afterEach(() => resetStores())

describe('the static GTFS reference', () => {
  it('is picked from the references already bound, not typed', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN), aFeed('harbor', HARBOR), aFeed('bikes', null)])
    renderForm()

    await user.click(await theReferencePicker())

    expect(await screen.findByRole('option', { name: DOWNTOWN })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: HARBOR })).toBeInTheDocument()
  })

  it('offers each distinct reference once, however many feeds share it', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN), aFeed('downtown-b', DOWNTOWN), aFeed('harbor', HARBOR)])
    renderForm()

    await user.click(await theReferencePicker())

    expect(await screen.findAllByRole('option', { name: DOWNTOWN })).toHaveLength(1)
  })

  it('defaults a new binding to the one reference this organization serves', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN)])
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText('Slug'), 'second-feed')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ staticGtfsRef: DOWNTOWN }))
  })

  it('leaves a new binding unpicked when the organization serves more than one', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN), aFeed('harbor', HARBOR)])
    const onSubmit = renderForm()

    await user.type(screen.getByLabelText('Slug'), 'third-feed')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/static GTFS reference is required/i)).toBeInTheDocument()
  })

  it('lands on free entry with no dead end when nothing is bound yet', async () => {
    const user = userEvent.setup()
    boundOn([])
    const onSubmit = renderForm()

    expect(screen.queryByRole('combobox', { name: /static gtfs reference/i })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Static GTFS reference'), DOWNTOWN)
    await user.type(screen.getByLabelText('Slug'), 'first-feed')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ staticGtfsRef: DOWNTOWN }))
  })

  it('keeps a second dataset reachable behind an explicit escape', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN)])
    const onSubmit = renderForm()

    await user.click(await theEscape())
    await user.type(screen.getByLabelText('Static GTFS reference'), HARBOR)
    await user.type(screen.getByLabelText('Slug'), 'harbor-feed')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ staticGtfsRef: HARBOR }))
  })

  it('does not default over an escape the operator has already taken', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN)])
    const onSubmit = renderForm()

    await user.click(await theEscape())
    await user.type(screen.getByLabelText('Slug'), 'harbor-feed')
    await user.click(screen.getByRole('button', { name: 'Publish' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/static GTFS reference is required/i)).toBeInTheDocument()
  })

  it('shows an edit its own reference even when no other feed carries it', async () => {
    const user = userEvent.setup()
    boundOn([aFeed('downtown', DOWNTOWN), aFeed('harbor', HARBOR)])
    const onSubmit = renderForm(aFeed('legacy', RETIRED))

    expect(await theReferencePicker()).toHaveTextContent(RETIRED)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ staticGtfsRef: RETIRED }))
  })
})
