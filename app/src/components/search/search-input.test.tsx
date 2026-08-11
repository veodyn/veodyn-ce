import { describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchInput } from './search-input'

describe('SearchInput', () => {
  it('renders a labelled searchbox holding the value', () => {
    render(<SearchInput value="rwa" onValueChange={() => {}} />)
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('rwa')
  })

  it('reports every keystroke', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(<SearchInput value="" onValueChange={onValueChange} />)

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'r')

    expect(onValueChange).toHaveBeenCalledWith('r')
  })

  it('shows a clear button only when there is a value', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const { rerender } = render(<SearchInput value="" onValueChange={onValueChange} />)
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()

    rerender(<SearchInput value="rwa" onValueChange={onValueChange} />)
    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(onValueChange).toHaveBeenCalledWith('')
  })

  it('forwards a ref to the underlying input so it can be focused', () => {
    const ref = createRef<HTMLInputElement>()
    render(<SearchInput ref={ref} value="" onValueChange={() => {}} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it('gives the clear button a visible focus ring and keeps its name', () => {
    render(<SearchInput value="metrics" onValueChange={() => {}} />)
    const clear = screen.getByRole('button', { name: 'Clear search' })
    expect(clear.className).toMatch(/focus-visible:/)
  })
})
