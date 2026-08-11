import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders, resetStores } from '@/test/utils'
import { RefreshRatePicker } from './refresh-rate-picker'

// Low, explicit bound rather than the default waitFor window: jsdom renders
// the popup within a couple of frames, so anything past a few hundred ms
// means the thing being waited on is never going to show up.
const FIND_TIMEOUT = 200

afterEach(() => {
  vi.restoreAllMocks()
  resetStores()
})

describe('RefreshRatePicker', () => {
  it('opens a real menu, moves through it with the keyboard, and closes on Escape', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RefreshRatePicker onRefresh={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Never' }))
    const menu = await screen.findByRole('menu', {}, { timeout: FIND_TIMEOUT })
    expect(menu).toBeInTheDocument()

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('renders every configured interval as a menu item', async () => {
    const user = userEvent.setup()
    renderWithProviders(<RefreshRatePicker onRefresh={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Never' }))
    await screen.findByRole('menu', {}, { timeout: FIND_TIMEOUT })

    for (const label of [
      'Never',
      '1 minute',
      '5 minutes',
      '10 minutes',
      '30 minutes',
      '1 hour',
      '12 hours',
      '24 hours',
    ]) {
      expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
    }
  })

  it('schedules a refresh on the selected interval and updates the trigger label', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()

    renderWithProviders(<RefreshRatePicker onRefresh={onRefresh} />)

    await user.click(screen.getByRole('button', { name: 'Never' }))
    // Wait only for the menu container: that role is unaffected by an item
    // regressing to a plain element, so it always resolves. The item itself
    // is then looked up with a synchronous getByRole, so its absence throws
    // immediately instead of waiting out an async window for an element
    // that, under a broken DropdownMenuItem, will never appear.
    await screen.findByRole('menu', {}, { timeout: FIND_TIMEOUT })
    const fiveMinuteItem = screen.getByRole('menuitem', { name: '5 minutes' })

    // Mocked only now, and only for this call: testing-library's own waitFor
    // polling relies on the real setInterval, so installing the mock any
    // earlier (before the menu has finished opening) makes findByRole hang.
    const setIntervalSpy = vi
      .spyOn(globalThis, 'setInterval')
      .mockImplementation(() => 1 as unknown as ReturnType<typeof setInterval>)

    await user.click(fiveMinuteItem)

    expect(screen.getByRole('button', { name: '5 minutes' })).toBeInTheDocument()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(setIntervalSpy).toHaveBeenCalledWith(onRefresh, 300_000)

    const refreshOnInterval = setIntervalSpy.mock.calls[0][0]
    refreshOnInterval()

    expect(onRefresh).toHaveBeenCalledOnce()
    expect(onRefresh).toHaveBeenCalledWith()
  })
})
