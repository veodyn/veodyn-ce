import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/utils'
import { EditorControls } from './editor-controls'

function renderControls(overrides: Partial<React.ComponentProps<typeof EditorControls>> = {}) {
  const props: React.ComponentProps<typeof EditorControls> = {
    onExecute: vi.fn(),
    onSave: vi.fn(),
    onFormat: vi.fn(),
    isExecuting: false,
    isSaving: false,
    isDirty: false,
    autoLimit: true,
    onAutoLimitChange: vi.fn(),
    showAutoLimit: true,
    ...overrides,
  }
  renderWithProviders(<EditorControls {...props} />)
  return props
}

describe('EditorControls', () => {
  // The Checkbox primitive is a `span[role="checkbox"]` plus a visually
  // hidden native mirror input for form semantics, so getByLabelText resolves
  // to two elements; getByRole with an accessible name is what proves the
  // htmlFor/id association without tripping over that mirror, matching this
  // codebase's own convention (see ui/checkbox.test.tsx).
  it('associates the LIMIT 1000 checkbox with its label', () => {
    renderControls()
    expect(screen.getByRole('checkbox', { name: /limit 1000/i })).toBeInTheDocument()
  })

  it('toggles auto limit through the labelled checkbox', async () => {
    const user = userEvent.setup()
    const onAutoLimitChange = vi.fn()
    renderControls({ onAutoLimitChange })

    await user.click(screen.getByRole('checkbox', { name: /limit 1000/i }))

    expect(onAutoLimitChange).toHaveBeenCalledOnce()
  })

  // JSON-syntax data sources (MetroCloudAlliance, GBFS, ...) have no LIMIT
  // clause to append, and appending one anyway breaks their query text - see
  // query-editor-page.tsx's isSqlDataSource gate.
  it('hides the LIMIT 1000 checkbox for a non-SQL data source', () => {
    renderControls({ showAutoLimit: false })
    expect(screen.queryByRole('checkbox', { name: /limit 1000/i })).not.toBeInTheDocument()
  })
})
