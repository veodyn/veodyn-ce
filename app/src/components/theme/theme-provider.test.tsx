import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider, useThemeScope } from '@/components/theme/theme-provider'
import { THEME_STORAGE_KEY } from '@/lib/theme-preference'

function Probe() {
  return <span>scope: {useThemeScope()}</span>
}

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
  document.documentElement.removeAttribute('data-theme')
  setSystemPrefersDark(false)
})

afterEach(() => {
  window.matchMedia = realMatchMedia
  document.documentElement.className = ''
})

describe('ThemeProvider', () => {
  it('follows the reader on a light OS', () => {
    const { container } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByText('scope: light')).toBeInTheDocument()
    expect(container.querySelector('[data-theme="light"]')).not.toBeNull()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('follows the reader onto a dark OS with no configuration at all', () => {
    setSystemPrefersDark(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByText('scope: dark')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('follows a stored preference over the OS', () => {
    setSystemPrefersDark(true)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByText('scope: light')).toBeInTheDocument()
  })

  // The class has to be on <html> rather than on the wrapper below it. Portalled
  // UI (dialog, popover, tooltip, dropdown, command palette) renders into
  // document.body, so a class on the wrapper leaves every one of them resolving
  // light tokens on a dark surface: CSS inheritance follows the DOM, not React.
  // That was a documented limitation of the old provider; this is the assertion
  // that keeps it fixed.
  it('puts the dark class on the document element, not only on its wrapper', () => {
    const { container } = render(
      <ThemeProvider force="dark">
        <Probe />
      </ThemeProvider>
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(container.querySelector('.dark')).toBeNull()
  })

  it('lets a surface force its own theme regardless of the preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    render(
      <ThemeProvider force="light">
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByText('scope: light')).toBeInTheDocument()
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  // The toaster cannot read CSS variables, so it picks its skin off this
  // context. If the context said light while <html> said dark, every toast on a
  // dark page would come up white.
  it('publishes the same scope it applies', () => {
    setSystemPrefersDark(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>
    )
    expect(screen.getByText('scope: dark')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
