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

  it('gives the viewport max-h-[inherit], so a max-h-* root actually clips', () => {
    // jsdom runs no layout, so this asserts the class rather than the height.
    // What it guards is a real regression: without it the viewport's
    // `size-full` (height:100%) does not resolve against an auto-height root,
    // so the viewport grows to its content and the list overflows its own
    // border instead of scrolling. That shipped once, on the feed query
    // picker, where the overflowing rows drew over the rest of the form.
    const { container } = render(
      <ScrollArea className="max-h-[280px]">
        <div>Taller than the cap</div>
      </ScrollArea>
    )

    const viewport = container.querySelector('[data-slot="scroll-area-viewport"]')
    expect(viewport).toHaveClass('max-h-[inherit]')
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
