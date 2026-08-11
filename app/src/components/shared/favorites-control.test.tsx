import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { FavoritesControl } from './favorites-control'

afterEach(() => resetStores())

describe('FavoritesControl', () => {
  // Button supplies focus-visible styling; a raw <button> here had none, so a
  // keyboard user could not see which control they were on.
  it('gives the star toggle a visible focus ring', () => {
    renderWithProviders(<FavoritesControl type="queries" id={1} isFavorite={false} />)

    const button = screen.getByRole('button', { name: 'Add to favorites' })
    expect(button.className).toMatch(/focus-visible:/)
  })

  // The star sits inside rows that are themselves links, so a click that
  // bubbles would navigate to the row's destination instead of toggling.
  it('does not let the toggle click reach the row around it', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()

    renderWithProviders(
      <div onClick={onRowClick}>
        <FavoritesControl type="queries" id={1} isFavorite={false} />
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Add to favorites' }))

    expect(onRowClick).not.toHaveBeenCalled()
  })
})
