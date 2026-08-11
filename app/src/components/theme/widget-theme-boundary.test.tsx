import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider, useThemeScope } from './theme-provider'
import { WidgetThemeBoundary } from './widget-theme-boundary'

// Stands in for a renderer that cannot read CSS and has to be told the theme:
// the maps pick a basemap URL exactly like this.
function ScopeProbe() {
  return <span data-testid="scope">{useThemeScope()}</span>
}

function renderIn(app: 'light' | 'dark', widget: 'auto' | 'light' | 'dark') {
  return render(
    <ThemeProvider force={app}>
      <WidgetThemeBoundary theme={widget}>
        <ScopeProbe />
      </WidgetThemeBoundary>
    </ThemeProvider>
  )
}

// The nearest [data-theme] ABOVE the probe, not the first one in the container:
// ThemeProvider renders its own data-theme wrapper, so querySelector finds the
// app's boundary and every assertion below then measures the wrong element.
function boundaryOf(): HTMLElement {
  const el = screen.getByTestId('scope').closest('[data-theme]')
  if (!el) throw new Error('[widget-theme] no boundary element rendered')
  return el as HTMLElement
}

describe('WidgetThemeBoundary', () => {
  it('follows the app when the widget asks for auto', () => {
    renderIn('dark', 'auto')
    expect(screen.getByTestId('scope').textContent).toBe('dark')
  })

  // The whole point of the feature: a panel on a wall looks the same to
  // everyone, whatever theme the person at the keyboard chose.
  it('pins dark inside a light app', () => {
    renderIn('light', 'dark')
    expect(screen.getByTestId('scope').textContent).toBe('dark')
    expect(boundaryOf().className).toContain('dark')
  })

  it('pins light inside a dark app', () => {
    renderIn('dark', 'light')
    expect(screen.getByTestId('scope').textContent).toBe('light')
    expect(boundaryOf().style.getPropertyValue('--background')).toBe('#F7F5F0')
  })

  // Both halves have to move together. Setting the tokens without the context
  // gives a dark panel holding a white map, which is the bug that started this;
  // setting the context without the tokens gives a dark map on a light panel.
  it('moves the token class and the renderer scope together', () => {
    renderIn('light', 'dark')
    const el = boundaryOf()
    expect(el.getAttribute('data-theme')).toBe('dark')
    expect(el.style.getPropertyValue('--background')).toBe('#0B0E14')
    expect(screen.getByTestId('scope').textContent).toBe('dark')
  })

  // display:contents for the default, because every map in here sizes itself
  // against its parent and an extra box in that chain is what collapsed them
  // all last time. A pinned widget does need a real box, to paint a background.
  it('adds no layout box when it is not overriding anything', () => {
    renderIn('light', 'auto')
    const el = boundaryOf()
    expect(el.className).toContain('contents')
    // No tokens either: 'auto' must be indistinguishable from having no
    // boundary at all, or it would pin the reader's current theme in place.
    expect(el.style.getPropertyValue('--background')).toBe('')
  })

  it('becomes a real painted box when it does override', () => {
    renderIn('light', 'dark')
    const className = boundaryOf().className
    expect(className).not.toContain('contents')
    expect(className).toContain('bg-background')
  })
})
