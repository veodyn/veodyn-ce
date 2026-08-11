import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '@/components/ui/input'

describe('Input', () => {
  it('renders and accepts typed text', async () => {
    render(<Input placeholder="Search datasets" />)
    const input = screen.getByPlaceholderText('Search datasets')
    await userEvent.type(input, 'ridership')
    expect(input).toHaveValue('ridership')
  })

  it('forwards a custom className alongside the base token classes', () => {
    render(<Input placeholder="Search datasets" className="my-input" />)
    expect(screen.getByPlaceholderText('Search datasets')).toHaveClass(
      'my-input',
      'border-input'
    )
  })

  it('fires onChange as the user types', async () => {
    const onChange = vi.fn()
    render(<Input placeholder="Search datasets" onChange={onChange} />)
    await userEvent.type(screen.getByPlaceholderText('Search datasets'), 'abc')
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('respects the disabled prop and blocks typing', async () => {
    render(<Input placeholder="Search datasets" disabled />)
    const input = screen.getByPlaceholderText('Search datasets')
    expect(input).toBeDisabled()
    await userEvent.type(input, 'ridership')
    expect(input).toHaveValue('')
  })
})
