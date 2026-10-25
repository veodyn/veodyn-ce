import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardText } from './dashboard-text'

describe('DashboardText', () => {
  it('renders elements, never author HTML', () => {
    const { container } = render(<DashboardText text={'## Hello\n<img src=x onerror=alert(1)>'} />)

    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('opens external links in a new tab without a referrer and keeps site links in place', () => {
    render(<DashboardText text="[Out](https://other.test) and [In](/traffic)" />)

    expect(screen.getByRole('link', { name: 'Out' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: 'Out' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: 'In' })).not.toHaveAttribute('target')
  })

  it('renders an image with its alt text', () => {
    render(<DashboardText text="![Detour map](https://cdn.test/detour.png)" />)

    expect(screen.getByRole('img', { name: 'Detour map' })).toHaveAttribute('src', 'https://cdn.test/detour.png')
  })
})
