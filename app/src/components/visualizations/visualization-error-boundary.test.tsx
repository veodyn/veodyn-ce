import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VisualizationErrorBoundary } from './visualization-error-boundary'

function Boom(): never {
  throw new Error('kaboom')
}

afterEach(() => vi.restoreAllMocks())

describe('VisualizationErrorBoundary', () => {
  it('renders the fallback and logs an AppError when a child throws', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <VisualizationErrorBoundary>
        <Boom />
      </VisualizationErrorBoundary>,
    )

    expect(screen.getByText(/failed to render visualization/i)).toBeInTheDocument()
    expect(consoleError.mock.calls.flat().join(' ')).toContain('E_UI_001')
  })

  it('renders children when they do not throw', () => {
    render(
      <VisualizationErrorBoundary>
        <span>ok</span>
      </VisualizationErrorBoundary>,
    )

    expect(screen.getByText('ok')).toBeInTheDocument()
  })

  it('offers a focusable Retry control when a visualization throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    render(
      <VisualizationErrorBoundary>
        <Boom />
      </VisualizationErrorBoundary>,
    )

    const retry = screen.getByRole('button', { name: /retry/i })
    expect(retry.className).toMatch(/focus-visible:/)
  })
})
