import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

function renderDialog() {
  return render(
    <Dialog defaultOpen>
      <DialogTrigger>Open</DialogTrigger>
      <DialogContent>
        <DialogTitle>Confirm delete</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('does not render its content when closed', () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm delete</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument()
  })

  it('renders its content when open', () => {
    renderDialog()
    expect(screen.getByText('Confirm delete')).toBeInTheDocument()
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument()
  })

  it('opens when the trigger is clicked', async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirm delete</DialogTitle>
        </DialogContent>
      </Dialog>
    )
    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Open'))

    expect(screen.getByText('Confirm delete')).toBeInTheDocument()
  })

  it('closes when the built-in close button is clicked', async () => {
    renderDialog()
    expect(screen.getByText('Confirm delete')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument()
  })

  it('closes via an explicit DialogClose element', async () => {
    render(
      <Dialog defaultOpen>
        <DialogContent showCloseButton={false}>
          <DialogTitle>Confirm delete</DialogTitle>
          <DialogClose>Cancel</DialogClose>
        </DialogContent>
      </Dialog>
    )
    expect(screen.getByText('Confirm delete')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByText('Confirm delete')).not.toBeInTheDocument()
  })
})

describe('DialogContent size and fill', () => {
  it('applies the requested max-width instead of the default', () => {
    render(
      <Dialog open>
        <DialogContent size="2xl">body</DialogContent>
      </Dialog>
    )
    const panel = screen.getByRole('dialog')
    expect(panel.className).toContain('max-w-6xl')
    expect(panel.className).not.toContain('sm:max-w-sm')
  })

  it('gives the panel a definite height only when fill is set', () => {
    const { rerender } = render(
      <Dialog open>
        <DialogContent>body</DialogContent>
      </Dialog>
    )
    expect(screen.getByRole('dialog').className).not.toContain('h-[85vh]')

    rerender(
      <Dialog open>
        <DialogContent fill>body</DialogContent>
      </Dialog>
    )
    const panel = screen.getByRole('dialog')
    // h-, not max-h-: a max-height leaves the height indefinite, which is the
    // defect fill exists to fix.
    expect(panel.className).toContain('h-[85vh]')
    expect(panel.className).toContain('flex-col')
  })

  it('caps the panel instead of fixing it when fill is "max"', () => {
    render(
      <Dialog open>
        <DialogContent fill="max">body</DialogContent>
      </Dialog>
    )
    const panel = screen.getByRole('dialog')
    expect(panel.className).toContain('max-h-[85vh]')
    // The point of the variant: a short conversation is a short dialog, not a
    // reply at the top of 85vh of empty panel. A definite height here would be
    // the defect, so the h-[85vh] the plain variant wants must be absent, and
    // `toContain` would match it inside max-h-[85vh].
    expect(panel.className.split(/\s+/)).not.toContain('h-[85vh]')
    expect(panel.className).toContain('flex-col')
    // Content-height panel, so shrinking is shared out across all three
    // regions; the footer holds the composer and cannot give any up.
    expect(panel.className).toContain('[&>[data-slot=dialog-footer]]:shrink-0')
  })
})

describe('DialogContent backdrop', () => {
  function backdrop() {
    const found = document.querySelector('[data-slot=dialog-overlay]')
    if (found == null) throw new Error('Expected the dialog to render a backdrop')
    return found
  }

  it('blurs the page behind by default', () => {
    render(
      <Dialog open>
        <DialogContent>body</DialogContent>
      </Dialog>
    )
    expect(backdrop().className).toContain('backdrop-blur-xs')
  })

  it('dims without blurring when asked', () => {
    render(
      <Dialog open>
        <DialogContent blurBackdrop={false}>body</DialogContent>
      </Dialog>
    )
    // Not blurred, and still a backdrop: dropping the element or its tint would
    // satisfy the first assertion on its own while leaving the panel floating
    // on a page that never dims.
    expect(backdrop().className).not.toContain('backdrop-blur')
    expect(backdrop().className).toContain('bg-black/10')
  })
})
