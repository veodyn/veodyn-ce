// The community half of this board. Everything below holds in a build with no
// feature package installed, and the registry is stubbed EMPTY here so it is
// actually exercised that way rather than merely written as though it were.
// The Metrics affected column's own coverage is
// src/components/kpi/feed-metrics.test.tsx, which drives this same page with
// the real registry.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/features/generated-registry', () => ({ FEATURES: {} }))

import { renderWithProviders, resetStores } from '@/test/utils'
import { useMockDataStore } from '@/stores/mock-data-store'
import CapturesPage from './page'

afterEach(() => resetStores())

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString()

describe('CapturesPage', () => {
  it('renders a row per capture with a status label (icon + text, not color alone)', async () => {
    useMockDataStore.setState({
      captures: [
        {
          id: 'a',
          name: 'Alpha Feed',
          source: 'Src A',
          cadence: 'hourly',
          lastReceivedAt: minutesAgo(30),
          status: 'fresh',
          datasetCount: 2,
        },
        {
          id: 'b',
          name: 'Beta Feed',
          source: 'Src B',
          cadence: 'daily',
          lastReceivedAt: minutesAgo(60 * 24 * 20),
          status: 'down',
          datasetCount: 1,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    expect(screen.getByRole('heading', { name: 'Captures' })).toBeInTheDocument()
    expect(await screen.findByText('Alpha Feed')).toBeInTheDocument()
    expect(screen.getByText('Beta Feed')).toBeInTheDocument()
    // Status shown as a text label, not color alone.
    expect(screen.getByText('Fresh')).toBeInTheDocument()
    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(screen.getByText('hourly')).toBeInTheDocument()
  })

  it('derives status from cadence and last received rather than the stored value', async () => {
    useMockDataStore.setState({
      captures: [
        {
          id: 'late',
          name: 'Late Feed',
          source: 'Src',
          // Claims to be fresh while three days late on a two-minute cadence.
          cadence: 'every 2 min',
          lastReceivedAt: minutesAgo(60 * 24 * 3),
          status: 'fresh',
          datasetCount: 0,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    await screen.findByText('Late Feed')
    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(screen.queryByText('Fresh')).not.toBeInTheDocument()
  })

  // Every capture on the stage instance reported a cadence of "not scheduled",
  // sitting next to a Last received of "59 seconds ago". The column carried no
  // information, and worse, deriveCaptureStatus silently stops aging a capture
  // it cannot parse a cadence for, so the verdict beside it was the upstream's
  // claim repeated back rather than anything checked.
  it('says when there is no cadence to judge a capture against', async () => {
    useMockDataStore.setState({
      captures: [
        {
          id: 'unscheduled',
          name: 'Unscheduled Feed',
          source: 'Src',
          cadence: 'not scheduled',
          lastReceivedAt: minutesAgo(1),
          status: 'fresh',
          datasetCount: 0,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    await screen.findByText('Unscheduled Feed')
    expect(screen.getByText(/age is not checked/i)).toBeInTheDocument()
    expect(screen.getByText('as reported')).toBeInTheDocument()
    // The unparseable string is not printed as though it were an interval.
    expect(screen.queryByText('not scheduled')).not.toBeInTheDocument()
  })

  it('keeps the cadence and claims nothing extra when the capture does declare one', async () => {
    useMockDataStore.setState({
      captures: [
        {
          id: 'scheduled',
          name: 'Scheduled Feed',
          source: 'Src',
          cadence: 'hourly',
          lastReceivedAt: minutesAgo(30),
          status: 'fresh',
          datasetCount: 0,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    await screen.findByText('Scheduled Feed')
    expect(screen.getByText('hourly')).toBeInTheDocument()
    expect(screen.queryByText('as reported')).not.toBeInTheDocument()
  })

  // The Metrics affected column is a slot, and its coverage is
  // components/kpi/feed-metrics.test.tsx, which drives this page through the
  // real registry. What stays here is the community half: in a build with no
  // contributor the column is absent, rather than drawn with "None" down every
  // row, which would say the captures affect nothing.
  it('shows no Metrics affected column when no feature fills it', async () => {
    useMockDataStore.setState({
      captures: [
        {
          id: 'gbfs',
          name: 'Bikeshare GBFS',
          source: 'gbfs',
          cadence: 'every 5 min',
          lastReceivedAt: minutesAgo(60 * 24 * 9),
          status: 'stale',
          datasetCount: 1,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    await screen.findByText('Bikeshare GBFS')
    expect(screen.queryByRole('columnheader', { name: 'Metrics affected' })).not.toBeInTheDocument()
  })

  // Item 3 of the F-07 work: without a declared interval nothing on this board
  // is checked, because deriveCaptureStatus has no period to age against and
  // falls back to repeating whatever the upstream last claimed.
  it('lets an operator declare how often a capture should deliver, and then checks it', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({
      captures: [
        {
          id: 'historical.q_capture_1',
          name: 'Unscheduled Feed',
          source: 'Src',
          cadence: 'not scheduled',
          // Ten days quiet, which no expectation would call fresh.
          lastReceivedAt: minutesAgo(60 * 24 * 10),
          status: 'fresh',
          datasetCount: 0,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    // Before: the upstream's claim, repeated back.
    await screen.findByText('Unscheduled Feed')
    expect(screen.getByText('as reported')).toBeInTheDocument()
    expect(screen.getByText('Fresh')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /set the expected interval for Unscheduled Feed/i })
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'hourly' }))

    // After: a period to age against, so the board judges rather than echoes.
    expect(await screen.findByText('hourly')).toBeInTheDocument()
    expect(screen.getByText('expected')).toBeInTheDocument()
    expect(screen.queryByText('as reported')).not.toBeInTheDocument()
    expect(screen.getByText('Down')).toBeInTheDocument()
    expect(screen.queryByText('Fresh')).not.toBeInTheDocument()
  })

  // The alert half. Only offered where there is a deadline to be late against:
  // arming without a declared interval would mean inventing a deadline and then
  // paging somebody about it.
  it('offers the alert only once an interval has been declared', async () => {
    const user = userEvent.setup()
    useMockDataStore.setState({
      captures: [
        {
          id: 'historical.q_capture_2',
          name: 'Quiet Feed',
          source: 'Src',
          cadence: 'not scheduled',
          lastReceivedAt: minutesAgo(1),
          status: 'fresh',
          datasetCount: 0,
        },
      ],
    })

    renderWithProviders(<CapturesPage />)

    await screen.findByText('Quiet Feed')
    expect(
      screen.queryByRole('button', { name: /alert me when Quiet Feed is late/i })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: /set the expected interval for Quiet Feed/i })
    )
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: 'hourly' }))

    const arm = await screen.findByRole('button', { name: /alert me when Quiet Feed is late/i })
    await user.click(arm)

    expect(
      await screen.findByRole('button', { name: /stop alerting when Quiet Feed is late/i })
    ).toBeInTheDocument()
  })
})
