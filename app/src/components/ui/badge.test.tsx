import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Badge } from '@/components/ui/badge'

describe('Badge', () => {
  it('renders its text', () => {
    render(<Badge>New</Badge>)
    expect(screen.getByText('New')).toBeInTheDocument()
  })

  it('applies a variant class', () => {
    render(<Badge variant="destructive">New</Badge>)
    expect(screen.getByText('New')).toHaveClass('text-destructive')
  })
})
