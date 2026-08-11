import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NoData } from '@/components/ui/no-data'

describe('NoData', () => {
  it('renders the empty-state message', () => {
    render(<NoData message="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('renders a ReactNode message, not just a string', () => {
    render(
      <NoData
        message={
          <>
            Nothing here. <a href="https://example.com/queries">Browse queries</a>
          </>
        }
      />
    )
    expect(screen.getByRole('link', { name: 'Browse queries' })).toBeInTheDocument()
  })

  it('wraps itself in card chrome only when card is set', () => {
    const { container, rerender } = render(<NoData message="empty" />)
    expect(container.firstChild).not.toHaveClass('border')

    rerender(<NoData message="empty" card />)
    expect(container.firstChild).toHaveClass('rounded-lg', 'border', 'bg-card')
  })
})
