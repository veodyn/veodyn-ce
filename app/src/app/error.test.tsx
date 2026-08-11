import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const forwardMock = vi.hoisted(() => ({ forwardBoundaryError: vi.fn() }))
vi.mock('@/lib/observability/errorForwarding', () => forwardMock)

import ErrorBoundary from './error'

beforeEach(() => vi.clearAllMocks())

describe('app error boundary', () => {
  it('tells the reader something went wrong', () => {
    render(<ErrorBoundary error={new Error('boom')} reset={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument()
  })

  it('forwards the error with its digest', () => {
    const error = Object.assign(new Error('boom'), { digest: 'd7' })
    render(<ErrorBoundary error={error} reset={vi.fn()} />)
    expect(forwardMock.forwardBoundaryError).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ digest: 'd7' }),
    )
  })

  it('shows the digest, which is the only handle on a production error', () => {
    const error = Object.assign(new Error('boom'), { digest: 'd7' })
    render(<ErrorBoundary error={error} reset={vi.fn()} />)
    expect(screen.getByText(/d7/)).toBeInTheDocument()
  })

  it('does not show a reference line when there is no digest', () => {
    render(<ErrorBoundary error={new Error('boom')} reset={vi.fn()} />)
    expect(screen.queryByText(/reference/i)).not.toBeInTheDocument()
  })

  it('offers a retry that calls reset', async () => {
    const reset = vi.fn()
    render(<ErrorBoundary error={new Error('boom')} reset={reset} />)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('never shows the raw error message, which can carry query data', () => {
    render(<ErrorBoundary error={new Error('SELECT revenue FROM acme')} reset={vi.fn()} />)
    expect(screen.queryByText(/acme/i)).not.toBeInTheDocument()
  })
})
