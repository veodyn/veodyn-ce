import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Trash2 } from 'lucide-react'
import { IconButton } from './icon-button'

describe('IconButton', () => {
  it('explains itself on hover', async () => {
    const user = userEvent.setup()
    render(
      <IconButton tooltip="Remove widget" variant="ghost" size="icon-sm">
        <Trash2 />
      </IconButton>
    )

    expect(screen.queryByText('Remove widget')).not.toBeInTheDocument()
    await user.hover(screen.getByRole('button'))
    await waitFor(() => {
      expect(screen.getByText('Remove widget')).toBeInTheDocument()
    })
  })

  it('explains itself on keyboard focus, not only under a pointer', async () => {
    const user = userEvent.setup()
    render(
      <IconButton tooltip="Remove widget" size="icon-sm">
        <Trash2 />
      </IconButton>
    )

    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await waitFor(() => {
      expect(screen.getByText('Remove widget')).toBeInTheDocument()
    })
  })

  it('names the button after its tooltip, so the icon is never unnamed', () => {
    render(
      <IconButton tooltip="Copy API key" size="icon-sm">
        <Trash2 />
      </IconButton>
    )
    expect(screen.getByRole('button', { name: 'Copy API key' })).toBeInTheDocument()
  })

  it('keeps a caller-supplied accessible name when it is more specific', () => {
    render(
      <IconButton tooltip="Delete" aria-label="Delete Weekly revenue" size="icon-sm">
        <Trash2 />
      </IconButton>
    )
    expect(screen.getByRole('button', { name: 'Delete Weekly revenue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('still clicks: the tooltip wrapper must not swallow the handler', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <IconButton tooltip="Remove widget" onClick={onClick} size="icon-sm">
        <Trash2 />
      </IconButton>
    )

    await user.click(screen.getByRole('button', { name: 'Remove widget' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('passes variant and size through to the button', () => {
    render(
      <IconButton tooltip="Remove widget" variant="destructive" size="icon-xs">
        <Trash2 />
      </IconButton>
    )
    const button = screen.getByRole('button', { name: 'Remove widget' })
    expect(button.className).toContain('size-6')
    expect(button.className).toContain('text-destructive')
  })
})
