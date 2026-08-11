import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from '@/components/layout/page-header'

describe('layout PageHeader', () => {
  it('renders the page title in the display serif', () => {
    render(<PageHeader title="Queries" />)
    expect(screen.getByRole('heading', { name: 'Queries' })).toHaveClass('font-display')
  })
})
