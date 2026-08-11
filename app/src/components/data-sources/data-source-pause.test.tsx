/**
 * Pausing a data source from its page. One switch stops every query and alert
 * behind it, which is the control you want when a feed goes bad: the
 * alternative is turning off schedules one query at a time while the dashboards
 * keep serving nonsense.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockDataSources } from '@/lib/mock-data'
import { useMockDataStore } from '@/stores/mock-data-store'
import { renderWithProviders, resetStores } from '@/test/utils'
import { DataSourcePause } from './data-source-pause'

const SOURCE_ID = 1

function seedSource(paused: number, pause_reason: string | null = null) {
  useMockDataStore.setState({
    dataSources: [{ ...mockDataSources[0], id: SOURCE_ID, paused, pause_reason }],
  })
}

function storedSource() {
  return useMockDataStore.getState().dataSources.find((d) => d.id === SOURCE_ID)
}

beforeEach(() => resetStores())
afterEach(() => {
  resetStores()
  useMockDataStore.setState({ dataSources: mockDataSources })
})

describe('an active data source', () => {
  it('offers a pause, with somewhere to say why', () => {
    seedSource(0)
    renderWithProviders(<DataSourcePause id={SOURCE_ID} paused={0} pauseReason={null} />)

    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByLabelText('Reason')).toBeInTheDocument()
  })

  // The reason is what tells whoever finds the paused source why, without
  // having to ask the person who paused it.
  it('records the reason it was given', async () => {
    const user = userEvent.setup()
    seedSource(0)
    renderWithProviders(<DataSourcePause id={SOURCE_ID} paused={0} pauseReason={null} />)

    await user.type(screen.getByLabelText('Reason'), 'Vehicle feed stalled')
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Pause' }))
    })

    expect(storedSource()?.paused).toBe(1)
    expect(storedSource()?.pause_reason).toBe('Vehicle feed stalled')
  })

  it('pauses without a reason when none was typed', async () => {
    const user = userEvent.setup()
    seedSource(0)
    renderWithProviders(<DataSourcePause id={SOURCE_ID} paused={0} pauseReason={null} />)

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Pause' }))
    })

    expect(storedSource()?.paused).toBe(1)
    expect(storedSource()?.pause_reason).toBeNull()
  })
})

describe('a paused data source', () => {
  it('says so, and says why', () => {
    seedSource(1, 'Vehicle feed stalled')
    renderWithProviders(
      <DataSourcePause id={SOURCE_ID} paused={1} pauseReason="Vehicle feed stalled" />
    )

    expect(screen.getByText(/paused/i)).toBeInTheDocument()
    expect(screen.getByText('Vehicle feed stalled')).toBeInTheDocument()
  })

  it('offers a resume instead of another pause', () => {
    seedSource(1, 'x')
    renderWithProviders(<DataSourcePause id={SOURCE_ID} paused={1} pauseReason="x" />)

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
  })

  it('clears the pause and its reason on resume', async () => {
    const user = userEvent.setup()
    seedSource(1, 'Vehicle feed stalled')
    renderWithProviders(
      <DataSourcePause id={SOURCE_ID} paused={1} pauseReason="Vehicle feed stalled" />
    )

    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Resume' }))
    })

    expect(storedSource()?.paused).toBe(0)
    expect(storedSource()?.pause_reason).toBeNull()
  })
})
