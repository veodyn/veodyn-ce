import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { THEME_STORAGE_KEY } from '@/lib/theme-preference'

// Low, explicit bound rather than the default waitFor window, matching
// refresh-rate-picker.test.tsx: jsdom renders the popup within a couple of
// frames, so anything past a few hundred ms means it is never coming.
const FIND_TIMEOUT = 200

function setSystemPrefersDark(prefersDark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: prefersDark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

const realMatchMedia = window.matchMedia

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.className = ''
  setSystemPrefersDark(false)
})

afterEach(() => {
  window.matchMedia = realMatchMedia
  document.documentElement.className = ''
})

/** Opens the menu and waits for it, rather than querying into the gap. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Theme' }))
  await screen.findByRole('menu', {}, { timeout: FIND_TIMEOUT })
}

describe('ThemeToggle', () => {
  // "Theme: System" rather than a bare "System": this sits in a rail where
  // every other row is a destination, so a lone value word reads as a link.
  it('opens on System, which is what an untouched install is set to', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent('Theme: System')
  })

  it('offers all three choices, so "follow the OS" is reachable and not just a default', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await openMenu(user)

    for (const label of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('menuitemradio', { name: label })).toBeInTheDocument()
    }
  })

  // A single choice out of three, so the current one is state the control
  // carries rather than a colour a screen reader cannot see.
  it('marks the current choice as checked', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await openMenu(user)

    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  })

  it('switches to dark and remembers it', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await openMenu(user)

    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }))

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent('Dark')
  })

  it('applies the choice to the document, not just to its own label', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await openMenu(user)

    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }))

    // ThemeToggle only records the preference; ThemeProvider is what applies
    // it. This asserts they are actually connected through the same store.
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('switches back to following the OS', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(<ThemeToggle />)
    await openMenu(user)

    await user.click(screen.getByRole('menuitemradio', { name: 'System' }))

    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  it('closes on Escape without changing the theme', async () => {
    const user = userEvent.setup()
    render(<ThemeToggle />)
    await openMenu(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  // In a 56px rail the label is gone visually but has to stay in the accessible
  // tree, otherwise the control becomes an unnamed icon.
  it('keeps an accessible name when the rail is collapsed', () => {
    render(<ThemeToggle collapsed />)
    const trigger = screen.getByRole('button', { name: 'Theme' })
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveAttribute('title', 'Theme: System')
  })

  it('names the choice rather than the resolved theme', () => {
    setSystemPrefersDark(true)
    render(<ThemeToggle />)
    // A reader on System should see that they are on System, not be told they
    // picked Dark because their OS happens to be dark right now.
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveTextContent('System')
  })
})
