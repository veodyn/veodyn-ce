import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

describe('DropdownMenu', () => {
  it('does not render its items when closed', () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
  })

  it('renders its items when open', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('opens when the trigger is clicked', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Actions'))

    await waitFor(() => {
      expect(screen.getByText('Rename')).toBeInTheDocument()
    })
  })

  it('fires the item handler and closes the menu when an item is selected', async () => {
    const onRename = vi.fn()
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={onRename}>Rename</DropdownMenuItem>
          <DropdownMenuItem>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    await userEvent.click(screen.getByText('Rename'))

    expect(onRename).toHaveBeenCalledTimes(1)
    // Base UI unmounts the popup on close rather than hiding it, so the
    // items are removed from the DOM, not merely made invisible.
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  // jsdom computes no layout, so this cannot watch the menu move. It guards the
  // cause instead: the entrance classes that made it move. Measured in Chrome
  // before the fix, the first item sat 8.4px above and 7.2px right of its
  // resting place 15ms after opening, against a 28px row, so a click aimed at
  // one item landed on its neighbour. The exit animation is deliberately not
  // covered: nothing is being aimed at while the menu leaves.
  it('opens where it will stay, instead of sliding and scaling into place', () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )

    const popup = screen.getByText('Rename').closest('[data-slot=dropdown-menu-content]')
    expect(popup).not.toBeNull()
    expect(popup?.className).not.toMatch(/slide-in-from/)
    expect(popup?.className).not.toMatch(/zoom-in/)
    // Still animated, just not in a way that moves the target.
    expect(popup?.className).toMatch(/fade-in/)
  })
})
