import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

describe('Sheet', () => {
  it('does not render its content when closed', () => {
    render(
      <Sheet>
        <SheetTrigger>Open menu</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Navigation</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument()
  })

  it('renders its content when open', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Jump to a section</SheetDescription>
        </SheetContent>
      </Sheet>
    )
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('Jump to a section')).toBeInTheDocument()
  })

  it('opens when the trigger is clicked', async () => {
    render(
      <Sheet>
        <SheetTrigger>Open menu</SheetTrigger>
        <SheetContent side="left">
          <SheetTitle>Navigation</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    expect(screen.queryByText('Navigation')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Open menu'))

    expect(screen.getByText('Navigation')).toBeInTheDocument()
  })

  it('renders on the side passed to SheetContent', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left">
          <SheetTitle>Navigation</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    const content = screen
      .getByText('Navigation')
      .closest('[data-slot="sheet-content"]')
    expect(content).toHaveAttribute('data-side', 'left')
  })

  it('closes when the built-in close button is clicked', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="right">
          <SheetTitle>Navigation</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    expect(screen.getByText('Navigation')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByText('Navigation')).not.toBeInTheDocument()
  })

  it('closes via an explicit SheetClose element', async () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="right" showCloseButton={false}>
          <SheetTitle>Navigation</SheetTitle>
          <SheetClose>Dismiss</SheetClose>
        </SheetContent>
      </Sheet>
    )
    expect(screen.getByText('Navigation')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Dismiss'))

    expect(screen.queryByText('Navigation')).not.toBeInTheDocument()
  })

  it('blurs the page behind by default, and only dims it when asked', () => {
    const { rerender } = render(
      <Sheet defaultOpen>
        <SheetContent>
          <SheetTitle>Navigation</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    expect(overlay().className).toContain('backdrop-blur-xs')

    rerender(
      <Sheet defaultOpen>
        <SheetContent blurBackdrop={false}>
          <SheetTitle>Navigation</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    // Still a backdrop: removing the element or its tint would satisfy the
    // no-blur assertion on its own, with the panel then floating over a page
    // that never dims.
    expect(overlay().className).not.toContain('backdrop-blur')
    expect(overlay().className).toContain('bg-black/10')
  })
})

function overlay(): Element {
  const found = document.querySelector('[data-slot=sheet-overlay]')
  if (found == null) throw new Error('Expected the sheet to render a backdrop')
  return found
}
