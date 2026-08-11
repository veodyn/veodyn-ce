import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders its children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('applies the destructive variant class', () => {
    render(<Button variant="destructive">Delete</Button>)
    expect(screen.getByRole('button')).toHaveClass('text-destructive')
  })

  it('fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not stamp a native button type when rendered as an anchor', () => {
    const { container } = render(<Button render={<a href="/x">Go</a>} />)
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor).toHaveAttribute('href', '/x')
    expect(anchor).not.toHaveAttribute('type')
  })

  it('keeps a native button type by default', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('honors an explicit nativeButton override on a rendered anchor', () => {
    const { container } = render(<Button render={<a href="/x">Go</a>} nativeButton />)
    expect(container.querySelector('a')).toHaveAttribute('type', 'button')
  })
})
