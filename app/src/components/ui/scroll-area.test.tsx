import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

// jsdom does not run layout, so the viewport never measures a real
// scrollable overflow: the Scrollbar/Thumb only mount when `keepMounted`
// forces them past that (unmeasurable) visibility check. Real scrolling
// (thumb drag, scroll position) is therefore not something these tests can
// exercise; they assert the structure and token classes that are observable
// instead.

describe('ScrollArea', () => {
  it('renders its children', () => {
    render(
      <ScrollArea className="h-24">
        <div>Scrollable nav content</div>
      </ScrollArea>
    )
    expect(screen.getByText('Scrollable nav content')).toBeInTheDocument()
  })

  it('forwards className and props to the root and renders the viewport slot', () => {
    const { container } = render(
      <ScrollArea className="h-24" data-testid="nav-scroll">
        <div>Scrollable nav content</div>
      </ScrollArea>
    )

    const root = container.querySelector('[data-slot="scroll-area"]')
    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')

    expect(root).toHaveClass('h-24')
    expect(root).toHaveAttribute('data-testid', 'nav-scroll')
    expect(viewport).toBeInTheDocument()
    expect(viewport).toContainElement(screen.getByText('Scrollable nav content'))
  })

  it('renders the scrollbar thumb with the border token class', async () => {
    const { getByTestId } = render(
      <ScrollArea className="h-24">
        <div>Scrollable nav content</div>
        <ScrollBar keepMounted data-testid="vertical-scrollbar" />
      </ScrollArea>
    )

    // The thumb's size and hidden-state are recomputed in a microtask after
    // mount; wait for that settle before asserting its class.
    await waitFor(() => {
      const thumb = getByTestId('vertical-scrollbar').querySelector(
        '[data-slot="scroll-area-thumb"]'
      )
      expect(thumb).toHaveClass('bg-border')
    })
  })
})
