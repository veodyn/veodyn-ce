import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, resetStores } from '@/test/utils'
import { ChangePasswordDialog } from './change-password-dialog'

afterEach(() => resetStores())

const fill = async (user: ReturnType<typeof userEvent.setup>, cur: string, next: string, confirm: string) => {
  await user.type(screen.getByLabelText(/current password/i), cur)
  await user.type(screen.getByLabelText(/^new password/i), next)
  await user.type(screen.getByLabelText(/confirm new password/i), confirm)
}

describe('ChangePasswordDialog', () => {
  it('keeps submit disabled until all three fields are filled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ChangePasswordDialog userId="7" open onClose={() => {}} />)
    const submit = screen.getByRole('button', { name: /^change password$/i })
    expect(submit).toBeDisabled()
    await fill(user, 'old', 'newpass', 'newpass')
    expect(submit).toBeEnabled()
  })

  it('rejects a mismatch and does not close', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<ChangePasswordDialog userId="7" open onClose={onClose} />)
    await fill(user, 'old', 'newpass', 'different')
    await user.click(screen.getByRole('button', { name: /^change password$/i }))
    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('rejects a password under six characters', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<ChangePasswordDialog userId="7" open onClose={onClose} />)
    await fill(user, 'old', 'short', 'short')
    await user.click(screen.getByRole('button', { name: /^change password$/i }))
    await waitFor(() => expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on success and clears the fields behind it', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderWithProviders(<ChangePasswordDialog userId="7" open onClose={onClose} />)
    await fill(user, 'oldpass', 'newpass', 'newpass')
    await user.click(screen.getByRole('button', { name: /^change password$/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // Reopening must not present the previous attempt's passwords.
    expect(screen.getByLabelText(/current password/i)).toHaveValue('')
  })
})
