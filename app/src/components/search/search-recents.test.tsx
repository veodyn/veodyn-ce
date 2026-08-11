import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchRecents } from './search-recents'

describe('SearchRecents', () => {
  it('shows a first-run hint when there is nothing to show', () => {
    render(<SearchRecents recents={[]} onRemove={() => {}} onClear={() => {}} />)
    expect(
      screen.getByText('Search across queries, dashboards, datasets, KPIs and reports.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Recent searches' })).not.toBeInTheDocument()
  })

  it('links each recent term back to its own search', () => {
    render(
      <SearchRecents recents={['on-time performance']} onRemove={() => {}} onClear={() => {}} />
    )
    expect(screen.getByRole('link', { name: 'on-time performance' })).toHaveAttribute(
      'href',
      '/search?q=on-time+performance'
    )
  })

  it('removes a single term', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<SearchRecents recents={['rwa']} onRemove={onRemove} onClear={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Remove rwa from recent searches' }))

    expect(onRemove).toHaveBeenCalledWith('rwa')
  })

  it('clears every term', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(<SearchRecents recents={['rwa', 'bike']} onRemove={() => {}} onClear={onClear} />)

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(onClear).toHaveBeenCalled()
  })

  it('gives the clear-all and remove buttons a visible focus ring', () => {
    render(<SearchRecents recents={['rwa']} onRemove={() => {}} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: 'Clear' }).className).toMatch(/focus-visible:/)
    expect(
      screen.getByRole('button', { name: 'Remove rwa from recent searches' }).className
    ).toMatch(/focus-visible:/)
  })
})
