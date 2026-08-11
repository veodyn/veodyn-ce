import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { TextboxDialog } from './textbox-dialog'

afterEach(() => resetStores())

describe('TextboxDialog', () => {
  it('renders the markdown editor and calls onClose from Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    renderWithProviders(
      <TextboxDialog open onClose={onClose} initialText="" onSave={() => {}} />
    )

    expect(screen.getByText(/add text box/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/some.*bold/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('passes edited markdown to onSave', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(
      <TextboxDialog open onClose={onClose} initialText="Old" onSave={onSave} />
    )

    const editor = screen.getByRole('textbox')
    await user.clear(editor)
    await user.type(editor, '# Current')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(onSave).toHaveBeenCalledWith('# Current')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
