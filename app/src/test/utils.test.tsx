import { describe, it, expect, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders, resetStores } from '@/test/utils'

afterEach(() => resetStores())

function Probe() {
  return <div>rendered</div>
}

describe('renderWithProviders', () => {
  it('renders a child inside the providers', () => {
    renderWithProviders(<Probe />)
    expect(screen.getByText('rendered')).toBeInTheDocument()
  })
})
