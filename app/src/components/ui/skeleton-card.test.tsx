import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { SkeletonCard } from '@/components/ui/skeleton-card'

describe('SkeletonCard', () => {
  it('renders an animated placeholder', () => {
    const { container } = render(<SkeletonCard />)
    expect(container.firstElementChild).toHaveClass('animate-pulse')
  })
})
