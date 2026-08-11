import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeOmnisearch } from '@/components/home/home-omnisearch'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

afterEach(() => push.mockClear())

describe('HomeOmnisearch', () => {
  it('routes a submitted query to the search results page', async () => {
    render(<HomeOmnisearch />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Omnisearch'), 'bus ridership')
    await user.keyboard('{Enter}')

    expect(push).toHaveBeenCalledWith('/search?q=bus%20ridership')
  })

  it('ignores an empty submission', async () => {
    render(<HomeOmnisearch />)
    const user = userEvent.setup()

    screen.getByLabelText('Omnisearch').focus()
    await user.keyboard('{Enter}')

    expect(push).not.toHaveBeenCalled()
  })
})
